# Next.js On Vercel For URL Ingestion

The application will use Next.js on Vercel so the UI and small server-side URL ingestion endpoint can live in one deployable app. This keeps the catalog local-first in the browser while avoiding the CORS limitations of a purely static GitHub Pages deployment when fetching public HTML sources.
