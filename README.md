<div align="center">

# 🥗 NutriSnap

**Snap a photo. Know your nutrition. Reach your goals.**

NutriSnap is a personal food tracker that lives on your phone.  
Point your camera at any meal and AI instantly figures out the calories and macros.  
No subscriptions. No cloud account. Your data stays on your device.

[Get Started →](#quick-start)

---

</div>

## What it does

| | |
|---|---|
| 📸 **Snap & track** | Point your camera at any meal — AI identifies the food and estimates calories, protein, carbs and fat in seconds |
| 📊 **Daily dashboard** | See at a glance how your day is going with a calorie ring and macro breakdown |
| ⚡ **AI daily coach** | Get one specific, personalised action to take today based on your actual eating history |
| ⏱️ **Fasting timer** | Start a fast with one tap, pick your protocol (16:8, 18:6, 24h), and track your history |
| ⚖️ **Weight goal** | Set a target weight and date, log your weight each day, and watch the progress bar |
| 📱 **Works offline** | Installable as a PWA — add to your home screen and use it like a native app |
| 🤖 **AI assistant** | Connect Claude or any MCP-compatible AI directly to your food data |

---

## Quick start

### What you need

- [Node.js 18 or newer](https://nodejs.org)
- An [OpenAI API key](https://platform.openai.com/api-keys) (used for food photo analysis and coaching)

### 1 · Clone and install

```bash
git clone https://github.com/you/nutrisnap
cd nutrisnap
npm install
```

### 2 · Add your API key

```bash
cp .env.example .env
```

Open `.env` and fill in:

```
OPENAI_API_KEY=sk-...your key here...
JWT_SECRET=any-long-random-string-you-choose
```

### 3 · Start

```bash
npm start
```

Open **http://localhost:3000**, create an account, and you're in.

---

## Connecting Claude (or any AI assistant)

NutriSnap has a built-in MCP server that lets AI assistants read your food log, check your fasting status, and even log meals for you — just by asking.

**Setup takes two steps:**

**Step 1 — Generate your key**  
Open the app → tap your profile → scroll to **AI assistant access** → tap **Generate key**.  
Copy the key shown (you'll only see the full key once).

**Step 2 — Add to Claude Desktop**  
Open your Claude Desktop config file (`~/.claude/claude_desktop_config.json`) and add:

```json
{
  "mcpServers": {
    "nutrisnap": {
      "url": "http://localhost:3001/sse",
      "headers": {
        "x-api-key": "ns_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. You can now ask things like:
- *"What did I eat today and how many calories is that?"*
- *"Log 200g of chicken breast for lunch"*
- *"How is my fast going?"*
- *"Am I on track for my weight goal?"*

---

## Running with Docker

```bash
docker-compose up -d
```

That's it. The app will be available at **http://localhost:3000**.

> Add your `OPENAI_API_KEY` and `JWT_SECRET` to a `.env` file in the project folder before starting.


<div align="center">

Made with ❤️ by [Neo](https://github.com/neooriginal)

</div>

