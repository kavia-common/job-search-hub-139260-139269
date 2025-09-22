import React, { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

/**
 * Simple client for fetching jobs from public/free-friendly endpoints.
 * We provide two providers:
 * 1) GitHub Jobs proxy (community mirror) - no API key.
 * 2) JSearch RapidAPI (optional) - requires API key via env variable REACT_APP_JSEARCH_KEY (future-friendly).
 *
 * Defaults to provider "github" which does not require a key.
 */
const PROVIDERS = {
  github: {
    name: 'GitHub (Mirror)',
    // Public community mirror of the deprecated GitHub Jobs for demo purposes:
    // Returns jobs array with fields: title, company, location, type, description, url, created_at
    // CORS friendly.
    buildUrl: ({ what, where, full_time, page }) => {
      const params = new URLSearchParams();
      if (what) params.set('description', what);
      if (where) params.set('location', where);
      if (full_time) params.set('full_time', 'true');
      if (page) params.set('page', String(page));
      return `https://remotive.com/api/remote-jobs?${what ? `search=${encodeURIComponent(what)}` : ''}`;
    },
    mapResult: (data) => {
      // Remotive shape: { jobs: [{ id, title, company_name, candidate_required_location, url, salary, tags, job_type, publication_date, ... }]}
      if (!data || !Array.isArray(data.jobs)) return [];
      return data.jobs.map(j => ({
        id: j.id,
        title: j.title,
        company: j.company_name,
        location: j.candidate_required_location || 'Remote',
        type: j.job_type || 'Unknown',
        url: j.url,
        created_at: j.publication_date,
        description: j.description || '',
        salary: j.salary || '',
        tags: j.tags || [],
        logo: j.company_logo_url || null
      }));
    }
  },
  jsearch: {
    name: 'JSearch (RapidAPI)',
    buildUrl: ({ what, where, page }) => {
      const q = [what, where].filter(Boolean).join(' in ');
      const params = new URLSearchParams();
      params.set('query', q || 'Software Developer');
      params.set('page', String(page || 1));
      params.set('num_pages', '1');
      return `https://jsearch.p.rapidapi.com/search?${params.toString()}`;
    },
    options: () => {
      const key = process.env.REACT_APP_JSEARCH_KEY;
      return key ? {
        headers: {
          'X-RapidAPI-Key': key,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
        }
      } : {};
    },
    mapResult: (data) => {
      // JSearch shape: { data: [{ job_id, job_title, employer_name, job_city, job_state, job_country, job_employment_type, job_posted_at_datetime_utc, job_min_salary, job_max_salary, job_apply_link, ...}]}
      if (!data || !Array.isArray(data.data)) return [];
      return data.data.map(j => ({
        id: j.job_id,
        title: j.job_title,
        company: j.employer_name,
        location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ') || 'Remote/NA',
        type: j.job_employment_type || 'Unknown',
        url: j.job_apply_link || j.job_apply_is_direct ? j.job_apply_link : j.job_google_link,
        created_at: j.job_posted_at_datetime_utc,
        description: j.job_description || '',
        salary: [j.job_min_salary, j.job_max_salary, j.job_salary_currency].some(Boolean)
          ? `${j.job_min_salary || ''} - ${j.job_max_salary || ''} ${j.job_salary_currency || ''}`.trim()
          : '',
        tags: (j.job_required_skills || []),
        logo: j.employer_logo || null
      }));
    }
  }
};

// Utilities
const formatDate = (iso) => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString();
  } catch { return ''; }
};
const clamp = (s, n = 140) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

const LS_KEYS = {
  applications: 'jobhub_applications',
  alerts: 'jobhub_alerts',
  preferences: 'jobhub_prefs'
};

function useLocalStorage(key, initial) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  return [state, setState];
}

function useNotifications() {
  const [permission, setPermission] = useState(Notification?.permission || 'default');

  // PUBLIC_INTERFACE
  const requestPermission = async () => {
    /** Request browser notification permission. */
    if (!('Notification' in window)) {
      toast.error('Notifications are not supported in this browser.');
      return 'denied';
    }
    const res = await Notification.requestPermission();
    setPermission(res);
    return res;
  };

  // PUBLIC_INTERFACE
  const notify = (title, options = {}) => {
    /** Fire a browser notification (if granted) and fallback to toast. */
    if ('Notification' in window && permission === 'granted') {
      const n = new Notification(title, options);
      setTimeout(() => n.close(), 4000);
    } else {
      toast.info(title);
    }
  };

  return { permission, requestPermission, notify };
}

function useDebounce(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// PUBLIC_INTERFACE
function App() {
  /** Main application for Job Search Hub (no auth, client-only tracking/alerts). */
  const [provider, setProvider] = useState('github');
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [type, setType] = useState('any'); // any | full-time | part-time | contract
  const [page] = useState(1); // demo single page
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');

  const [applications, setApplications] = useLocalStorage(LS_KEYS.applications, []);
  const [alerts, setAlerts] = useLocalStorage(LS_KEYS.alerts, []);
  const [prefs, setPrefs] = useLocalStorage(LS_KEYS.preferences, { theme: 'light' });

  const { permission, requestPermission, notify } = useNotifications();
  const debouncedQuery = useDebounce(query, 400);
  const debouncedLocation = useDebounce(location, 400);

  const filteredJobs = useMemo(() => {
    return jobs.filter(j => {
      if (type !== 'any') {
        const jt = (j.type || '').toLowerCase();
        if (!jt.includes(type.toLowerCase())) return false;
      }
      return true;
    });
  }, [jobs, type]);

  useEffect(() => {
    document.documentElement.style.background = 'var(--bg)';
  }, []);

  useEffect(() => {
    const run = async () => {
      setError('');
      setLoading(true);
      try {
        const prov = PROVIDERS[provider];
        const url = prov.buildUrl({
          what: debouncedQuery,
          where: debouncedLocation,
          full_time: type === 'full-time',
          page
        });
        const options = prov.options ? prov.options() : {};
        const res = await fetch(url, options);
        if (!res.ok) throw new Error(`Network error: ${res.status}`);
        const data = await res.json();
        const mapped = prov.mapResult(data);
        setJobs(mapped);
      } catch (e) {
        setError(e.message || 'Failed to fetch jobs.');
      } finally {
        setLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, debouncedQuery, debouncedLocation, type, page]);

  const handleTrack = (job) => {
    const exists = applications.find(a => a.id === job.id);
    if (exists) {
      toast.info('Already added to your applications.');
      return;
    }
    const entry = { ...job, status: 'Interested', notes: '', saved_at: Date.now() };
    setApplications([entry, ...applications]);
    toast.success('Added to Applications');
  };

  const updateApplication = (id, patch) => {
    setApplications(applications.map(a => a.id === id ? { ...a, ...patch } : a));
  };

  const removeApplication = (id) => {
    setApplications(applications.filter(a => a.id !== id));
  };

  const createAlert = async (q, loc, intervalMinutes) => {
    // Request permission if not granted
    if (permission !== 'granted') {
      await requestPermission();
    }
    const alert = {
      id: crypto.randomUUID(),
      q: q || '',
      loc: loc || '',
      every: intervalMinutes || 60,
      created_at: Date.now(),
      next_at: Date.now() + (intervalMinutes || 60) * 60 * 1000
    };
    setAlerts([alert, ...alerts]);
    notify('Job Alert created', { body: `We will remind you about "${q || 'jobs'}" every ${alert.every} min.` });
  };

  const removeAlert = (id) => setAlerts(alerts.filter(a => a.id !== id));

  // Schedule local alert checks
  const alertTimer = useRef(null);
  useEffect(() => {
    if (alertTimer.current) clearInterval(alertTimer.current);
    alertTimer.current = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const updated = alerts.map(a => {
        if (now >= a.next_at) {
          notify(`Job Alert: ${a.q || 'New jobs'}`, { body: a.loc ? `Around ${a.loc}` : 'Check latest roles' });
          changed = true;
          return { ...a, next_at: now + a.every * 60 * 1000 };
        }
        return a;
      });
      if (changed) setAlerts(updated);
    }, 15000);
    return () => clearInterval(alertTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts, notify]);

  return (
    <div className="app">
      <header className="header">
        <div className="navbar">
          <div className="brand">
            <div className="brand-badge">🌊</div>
            Ocean Jobs
            <span className="badge">Modern • No-login</span>
          </div>
          <div className="nav-actions">
            <button className="btn" onClick={() => {
              const next = prefs.theme === 'light' ? 'dark' : 'light';
              setPrefs({ ...prefs, theme: next });
              document.documentElement.classList.toggle('dark', next === 'dark');
              toast.info(`Theme: ${next}`);
            }}>
              {prefs.theme === 'light' ? '🌙 Dark' : '☀️ Light'}
            </button>
            <a className="btn btn-primary" href="#applications">My Applications</a>
          </div>
        </div>
        <div className="section" style={{ maxWidth: 1200, margin: '0 auto', paddingInline: 20, paddingBottom: 16 }}>
          <div className="card section">
            <div className="kicker">Welcome</div>
            <div className="title">Find your next role</div>
            <div className="searchbar" role="search">
              <input className="input" placeholder="Keyword (e.g., React, Designer, Data)" value={query} onChange={(e)=>setQuery(e.target.value)} />
              <input className="input" placeholder="Location (e.g., Remote, Berlin)" value={location} onChange={(e)=>setLocation(e.target.value)} />
              <select className="select" value={type} onChange={(e)=>setType(e.target.value)}>
                <option value="any">Any Type</option>
                <option value="full-time">Full-time</option>
                <option value="part-time">Part-time</option>
                <option value="contract">Contract</option>
              </select>
              <div className="utilities">
                <button className="btn btn-primary" onClick={() => toast.info('Searching…')}>Search</button>
                <select className="select" aria-label="Job Provider" value={provider} onChange={(e)=>setProvider(e.target.value)}>
                  <option value="github">Free: Remotive</option>
                  <option value="jsearch">Optional: JSearch (RapidAPI)</option>
                </select>
              </div>
            </div>
            <div className="divider" />
            <div className="utilities" style={{ justifyContent: 'space-between' }}>
              <span className="kicker">Tip: Add alerts to get periodic reminders in your browser. No login required.</span>
              <button className="btn btn-amber" onClick={() => createAlert(query, location, 60)}>Create 1h Alert</button>
            </div>
          </div>
        </div>
      </header>

      <main className="main">
        <aside className="sidebar card section" aria-label="Filters">
          <div className="kicker">Filters</div>
          <div className="title">Refine search</div>
          <div className="filter-row">
            <label className="kicker">Job Type</label>
            <select className="select" value={type} onChange={(e)=>setType(e.target.value)}>
              <option value="any">Any</option>
              <option value="full-time">Full-time</option>
              <option value="part-time">Part-time</option>
              <option value="contract">Contract</option>
            </select>
          </div>
          <div className="filter-row">
            <label className="kicker">Location</label>
            <input className="input" placeholder="City / Remote" value={location} onChange={(e)=>setLocation(e.target.value)} />
          </div>
          <div className="filter-row">
            <label className="kicker">Provider</label>
            <select className="select" value={provider} onChange={(e)=>setProvider(e.target.value)}>
              <option value="github">Remotive (Free)</option>
              <option value="jsearch">JSearch (API Key)</option>
            </select>
            {provider === 'jsearch' && (
              <small className="kicker">Set REACT_APP_JSEARCH_KEY in .env to enable.</small>
            )}
          </div>
        </aside>

        <section className="content card section" aria-live="polite">
          <div className="kicker">Results</div>
          <div className="title">Matching jobs</div>

          {loading && <div className="empty">Loading jobs…</div>}
          {error && !loading && <div className="empty" style={{ color: 'var(--error)' }}>Error: {error}</div>}
          {!loading && !error && filteredJobs.length === 0 && (
            <div className="empty">No jobs found. Try broadening your search or changing provider.</div>
          )}

          <div className="jobs">
            {filteredJobs.map(job => (
              <article key={job.id} className="job-card">
                <div className="job-logo" aria-hidden="true">
                  {job.logo ? <img src={job.logo} alt="" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10 }} /> : (job.company || '🏢').slice(0,2)}
                </div>
                <div>
                  <div className="job-title">{job.title}</div>
                  <div className="job-meta">
                    <span>{job.company || 'Unknown Company'}</span>
                    <span>•</span>
                    <span>{job.location || 'Location NA'}</span>
                    <span>•</span>
                    <span className="badge">{job.type}</span>
                    {job.salary && (<><span>•</span><span className="salary">{job.salary}</span></>)}
                    {job.created_at && (<><span>•</span><span>Posted {formatDate(job.created_at)}</span></>)}
                  </div>
                  <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 13 }}>{clamp(job.description, 180)}</div>
                </div>
                <div className="job-actions">
                  <a className="btn" href={job.url} target="_blank" rel="noreferrer">View</a>
                  <button className="btn btn-primary" onClick={() => handleTrack(job)}>Track</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="alerts card section" aria-label="Alerts">
          <div className="kicker">Alerts</div>
          <div className="title">Job alerts</div>
          <div className="alerts-list">
            {alerts.length === 0 && <div className="empty">You have no alerts yet.</div>}
            {alerts.map(a => (
              <div key={a.id} className="card section" style={{ padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{a.q || 'Any keyword'}</div>
                    <div className="kicker">{a.loc || 'Anywhere'} • every {a.every} min</div>
                    <div className="kicker">Next: {new Date(a.next_at).toLocaleTimeString()}</div>
                  </div>
                  <div className="utilities">
                    <button className="btn" onClick={() => {
                      const now = Date.now();
                      const updated = alerts.map(x => x.id === a.id ? { ...x, next_at: now + x.every*60*1000 } : x);
                      setAlerts(updated);
                      notify('Snoozed alert', { body: 'We will remind you later.' });
                    }}>Snooze</button>
                    <button className="btn" onClick={() => removeAlert(a.id)}>Remove</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="divider" />
          <button className="btn" onClick={() => createAlert(query, location, 15)}>Create 15m Alert</button>
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => requestPermission()}>Enable Notifications</button>
          <small className="kicker" style={{ display: 'block', marginTop: 8 }}>
            Notifications are local to this browser. No account required.
          </small>
        </aside>
      </main>

      <section id="applications" className="card section" style={{ maxWidth: 1200, margin: '0 auto 40px', paddingInline: 20 }}>
        <div className="kicker">Dashboard</div>
        <div className="title">My Applications</div>
        {applications.length === 0 && (
          <div className="empty">No tracked applications yet. Add jobs from the results list.</div>
        )}
        <div className="jobs">
          {applications.map(app => (
            <div key={app.id} className="job-card">
              <div className="job-logo" aria-hidden="true">
                {(app.company || '🏢').slice(0,2)}
              </div>
              <div>
                <div className="job-title">{app.title}</div>
                <div className="job-meta">
                  <span>{app.company}</span>
                  <span>•</span>
                  <span>{app.location}</span>
                  {app.salary && (<><span>•</span><span className="salary">{app.salary}</span></>)}
                </div>
                <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                  <div className="utilities">
                    <label className="kicker" htmlFor={`status-${app.id}`}>Status</label>
                    <select id={`status-${app.id}`} className="select" value={app.status} onChange={(e)=>updateApplication(app.id, { status: e.target.value })}>
                      <option>Interested</option>
                      <option>Applied</option>
                      <option>Interview</option>
                      <option>Offer</option>
                      <option>Rejected</option>
                    </select>
                  </div>
                  <textarea
                    className="input"
                    rows={3}
                    placeholder="Notes (e.g., recruiter name, next step, reminders)"
                    value={app.notes}
                    onChange={(e)=>updateApplication(app.id, { notes: e.target.value })}
                  />
                </div>
              </div>
              <div className="job-actions">
                <a className="btn" href={app.url} target="_blank" rel="noreferrer">Open</a>
                <button className="btn" onClick={() => removeApplication(app.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="section" style={{ textAlign: 'center', color: 'var(--muted)' }}>
        <div>Made with the Ocean Professional theme • Blue & Amber accents</div>
        <div style={{ marginTop: 6, fontSize: 12 }}>
          Data from public sources (Remotive API by default). Add a RapidAPI key in .env to enable JSearch.
        </div>
      </footer>

      <ToastContainer position="bottom-right" />
    </div>
  );
}

export default App;
