# Trafilatura precision extractor (optional sidecar)

The product spec names **Trafilatura** as the precision extractor. The npm
`trafilatura` package is a native N-API binding and cannot run in a portable
JS runtime, so the real library runs here as a tiny Python sidecar.

The JS pipeline uses it whenever `TRAFILATURA_URL` is set; otherwise it falls
back to `defuddle` (a Trafilatura-class JS extractor). Both sit behind the same
`Extractor` seam, and the 60% precision/recall rule is unchanged.

## Setup

```powershell
cd services/extractor
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py --port 8100
```

Then point the app at it:

```powershell
$env:TRAFILATURA_URL="http://127.0.0.1:8100/extract"
bun run dev
```

`GET /health` reports the installed version. `POST /extract` accepts
`{"html": "...", "url": "https://..."}` and returns:

```json
{
  "markdown": "...",
  "title": "...",
  "author": null,
  "date": null,
  "language": "zh",
  "images": []
}
```

Verified locally with Python 3.15.0 and trafilatura 2.3.1.
