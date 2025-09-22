#!/bin/bash
cd /home/kavia/workspace/code-generation/job-search-hub-139260-139269/job_platform_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

