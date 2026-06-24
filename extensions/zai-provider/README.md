# @ngdangdat/pi-zai-provider

Z.AI (GLM models) provider extension for the [pi coding agent](https://github.com/badlogic/pi-mono). Registers all Z.AI GLM models using the OpenAI-compatible coding API with API key authentication.

Forked from [@thesethrose/pi-zai-provider](https://github.com/TheSethRose/pi-zai-provider) with GLM-5.2 support added.

## Models

| Model | Context | Max Output | Input $/MTok | Output $/MTok |
|---|---|---|---|---|
| GLM-5.2 | 1M | 131K | TBD | TBD |
| GLM-5.1 | 200K | 128K | $1.00 | $3.20 |
| GLM-5 | 200K | 128K | $1.00 | $3.20 |
| GLM-5 Turbo | 200K | 128K | $1.20 | $4.00 |
| GLM-5 Code | 200K | 128K | $1.20 | $5.00 |
| GLM-4.7 | 200K | 128K | $0.60 | $2.20 |
| GLM-4.7 Flash | 200K | 128K | Free | Free |
| GLM-4.7 FlashX | 200K | 128K | $0.07 | $0.40 |
| GLM-4.6 | 200K | 128K | $0.60 | $2.20 |
| GLM-4.5 | 200K | 96K | $0.60 | $2.20 |
| GLM-4.5 Air | 200K | 96K | $0.20 | $1.10 |
| GLM-4.5 Flash | 200K | 96K | Free | Free |
| GLM-4.5 X | 200K | 96K | $2.20 | $8.90 |
| GLM-4.5 AirX | 200K | 96K | $1.10 | $4.50 |

## Installation

```bash
# From GitHub
pi install git:github.com/ngdangdat/pi-packages/extensions/zai-provider
```

## Setup

After installing, authenticate with your Z.AI API key:

```
/login zai
```

Get your API key at: https://z.ai/manage-apikey

## Usage

Switch to a Z.AI model:

```
/model glm-5.1
```

## Notes

- Uses the coding-specific endpoint (`api.z.ai/api/coding/paas/v4`) for plan quota consumption
- Pi has native Z.AI compat built-in: `enable_thinking` param, `reasoning_content` streaming, and correct compat flags auto-detected from the `api.z.ai` URL
- GLM-5.2 uses a 1M context window and 131K max output per Z.AI's latest model documentation
- GLM-5.2 supports High and Max thinking-effort levels. This provider maps Pi `high` to Z.AI `high` and Pi `xhigh` to Z.AI `max`; use `xhigh`/Max for coding tasks for deeper reasoning and more reliable performance.
- GLM-5.1 is available on all GLM Coding Plan tiers; GLM-5 requires Pro or Max
