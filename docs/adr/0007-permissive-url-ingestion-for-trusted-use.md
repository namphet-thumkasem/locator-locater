# Permissive URL Ingestion For Trusted Use

URL ingestion will start permissive because the app is intended as a niche trusted tool rather than a public multi-tenant proxy. This accepts SSRF-style risk in exchange for supporting internal sites, local development servers, and IP-based targets; the deployment owner is responsible for not exposing the ingestion endpoint broadly.
