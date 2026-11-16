# Advanced Research Paper Studio

Full-stack Node.js application with:
- AI-assisted drafting: full manuscript scaffold or individual sections.
- Optional live web search through the OpenAI Responses API.
- Crossref literature metadata discovery and DOI links.
- AI manuscript critique / reviewer-style report.
- DOCX text extraction, style-oriented reflow and DOCX export.
- Browser-local draft save/load.
- Server-side API key, app-password gate, rate limiting, upload limits and security headers.

## Requirements
- Node.js 20+
- An OpenAI API key with API billing/credits and access to the selected model.
- A server that runs Node.js. GitHub Pages alone cannot run this backend.

## Local installation
1. Extract this project.
2. Open a terminal in the project folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Set `OPENAI_API_KEY` and a long random `APP_PASSWORD`. Keep `.env` private.
6. Check `OPENAI_MODEL` is available to your API project. Default is `gpt-5.5`; change it if your account uses a different model.
7. Run `npm start`.
8. Open http://localhost:3000 and enter APP_PASSWORD.

## Deploy on Render
1. Create a private GitHub repository and upload these project files. Do NOT upload `.env` or node_modules.
2. In Render, choose New > Web Service and connect the repository.
3. Runtime: Node; Build command: `npm install`; Start command: `npm start`.
4. Add environment variables in Render:
   - `OPENAI_API_KEY` = your secret API key
   - `APP_PASSWORD` = a long unique password
   - `OPENAI_MODEL` = a model available to your API project (default `gpt-5.5`)
   - `MAX_UPLOAD_MB` = `15`
5. Deploy. Visit the generated Render URL and enter the app password.
6. Do not set the API key in frontend code, GitHub Pages, or a public repository.
7. If hosting frontend and backend on separate origins, set `ALLOWED_ORIGIN` to the exact frontend origin. For this all-in-one deployment, leave it blank.

## Security notes
- App password is a simple single-shared-password gate, not multi-user identity management. For a commercial/public multi-user product, add proper accounts, database-backed sessions, CSRF protection, per-user quotas, billing and audit logging.
- Use HTTPS. Render provides HTTPS on its public service URL.
- Rotate any API key accidentally committed or exposed.
- API calls cost money according to your OpenAI API account; ChatGPT subscription and API billing are separate.
- The app uses a rate limit and upload size limit, but should still be monitored for abuse and cost.

## Academic and conversion limitations
- AI drafts can contain factual errors. Verify every assertion, calculation, source and DOI.
- Crossref search is metadata discovery, not a guarantee that a paper is relevant, peer-reviewed, or indexed in Scopus/Web of Science.
- Web search results must be checked against the original publisher/source.
- DOCX conversion is text-only reflow. It does not preserve images, complex tables, equations, footnotes, reference-manager fields, tracked changes, page layout, or exact official IEEE/Springer/Elsevier templates. Exact publisher templates vary by venue. Use the current official template for final submission.
- This app does not guarantee journal acceptance, conference acceptance, indexing, plagiarism clearance or ethical approval.
