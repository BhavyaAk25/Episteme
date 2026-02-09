# 🚀 SETUP GUIDE — What You (Human) Need to Do

Follow these steps IN ORDER before handing off to Claude Code or Codex.

---

## Step 1: Get Your Gemini API Key (2 minutes)

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with your Google account
3. Click **"Create API Key"**
4. Select any Google Cloud project (or create one — it's free)
5. **Copy the key** — you'll need it in Step 4
6. This gives you free access to `gemini-3-flash-preview` (30 requests/min, 1M tokens/min)

---

## Step 2: Verify Your Machine Has Node.js (1 minute)

Open a terminal and run:
```bash
node --version
```
You need **v18.0.0 or higher**. If not installed:
- **Mac:** `brew install node` (or download from https://nodejs.org)
- **Windows:** Download from https://nodejs.org (LTS version)
- **Linux:** `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs`

Also verify npm:
```bash
npm --version
```

---

## Step 3: Create the Project Folder (1 minute)

```bash
# Create project on your Desktop (or wherever you want)
mkdir -p ~/Desktop/episteme
cd ~/Desktop/episteme

# Initialize git
git init
```

---

## Step 4: Copy the Handoff Files Into the Project (2 minutes)

Copy these files (that Claude just created for you) into `~/Desktop/episteme/`:

```
~/Desktop/episteme/
├── CLAUDE.md              # Main project context
├── NEXTAGENT.md           # Session handoff tracker
├── EPISTEME_SKILL.md      # Domain knowledge (schemas, patterns)
├── GEMINI_PROMPTS.md      # System prompts for Gemini
└── .env.local             # Create this with your API key
```

Create the `.env.local` file:
```bash
cd ~/Desktop/episteme
echo "GEMINI_API_KEY=YOUR_API_KEY_HERE" > .env.local
echo "NEXT_PUBLIC_APP_NAME=Episteme" >> .env.local
```

Replace `YOUR_API_KEY_HERE` with the key from Step 1.

---

## Step 5: First Commit (30 seconds)

```bash
cd ~/Desktop/episteme
git add -A
git commit -m "session 0: project planning and handoff files"
```

---

## Step 6: Install Vercel CLI (1 minute)

```bash
npm install -g vercel
```

You'll use this later to deploy. If it asks you to log in:
```bash
vercel login
```
(Use your email — free account is fine.)

---

## Step 7: Hand Off to Claude Code or Codex

### For Claude Code (Terminal):
```bash
cd ~/Desktop/episteme
claude
```
Then tell it:
```
Read CLAUDE.md and NEXTAGENT.md in this directory, then start working on the highest priority task. This is a hackathon project — move fast but keep code quality high. When you're running low on tokens, update NEXTAGENT.md before ending.
```

### For Codex:
Open Codex and point it to the `~/Desktop/episteme` directory. Give it the same instruction.

### For Subsequent Sessions:
```
Read NEXTAGENT.md first. It has everything you need to know about what was done and what's next. Then read CLAUDE.md for full context. Start on the highest priority incomplete task.
```

---

## Step 8: During Development — Your Role

While the agents code, you'll occasionally need to:

1. **Provide the API key** if the agent asks (it's in .env.local)
2. **Test in browser** — open http://localhost:3000 and report what you see
3. **Deploy to Vercel** when ready:
   ```bash
   cd ~/Desktop/episteme
   npx vercel --prod
   ```
4. **Record the 3-minute demo video** (use screen recorder — OBS, QuickTime, or Loom)
5. **Submit to Devpost** with:
   - Public URL (Vercel link)
   - GitHub repo link
   - Demo video (upload to YouTube as unlisted, or use Loom)
   - ~200 word write-up about Gemini integration
   - Architecture diagram (the agent can generate this)

---

## Step 9: Hackathon Submission Checklist

Before submitting, verify:

- [ ] App is live at a public Vercel URL
- [ ] No login required to use it
- [ ] Type a prompt → Generate builds the ERD with animation
- [ ] Simulate shows test results with pass/fail
- [ ] Auto-Fix patches at least one failure
- [ ] Export downloads a zip with schema.sql + ontology.json
- [ ] 3-minute demo video recorded and uploaded
- [ ] GitHub repo is public
- [ ] ~200 word Gemini integration write-up done
- [ ] Architecture diagram included (can be a screenshot from the app or a separate image)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "GEMINI_API_KEY is not defined" | Make sure .env.local exists and has the key. Restart dev server. |
| Gemini returns 429 (rate limit) | Free tier is 30 RPM. Wait 60 seconds or add retry logic. |
| React Flow blank canvas | Make sure the container has explicit width/height. Check CSS. |
| sql.js WASM not loading | Make sure the WASM file is served from public/ or CDN |
| Vercel build fails | Check `npm run build` locally first. Fix TypeScript errors. |
| "Module not found" | Run `npm install` again. Check import paths. |

---

## Timeline Suggestion

| Phase | Time | What |
|-------|------|------|
| Session 1 | ~2 hours | Scaffolding + Layout + Stores + Dark theme |
| Session 2 | ~3 hours | Gemini API routes + ERD generation + Canvas |
| Session 3 | ~2 hours | Build animation + Ontology sidebar + Inspector |
| Session 4 | ~2 hours | Simulation system (sql.js) + Bottom drawer |
| Session 5 | ~2 hours | Auto-fix loop + Export system |
| Session 6 | ~1 hour | Polish, error handling, loading states |
| Deploy | ~30 min | Vercel deploy + test public URL |
| Demo | ~1 hour | Record 3-minute video |
| Submit | ~30 min | Fill in Devpost form |

**Total: ~14 hours of agent coding + ~2 hours of your time**

---

Good luck. Let's win that $50K. 🏆
