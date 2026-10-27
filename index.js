const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: 'text/plain', limit: '1mb' }));

const PORT = process.env.PORT || 10000;
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO || 'handoff-memory';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE = 'HANDOFF.md';
const WRITE_KEY = process.env.WRITE_KEY;

const gh = new Octokit({ auth: process.env.GITHUB_PAT });

function checkKey(req, res) {
  if (!WRITE_KEY || req.get('x-write-key') !== WRITE_KEY) {
    res.status(401).json({ error: 'Wrong or missing write key.' });
    return false;
  }
  return true;
}

async function getFile() {
  try {
    const { data } = await gh.repos.getContent({ owner: OWNER, repo: REPO, path: FILE, ref: BRANCH });
    return { sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf8') };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

function fail(res, err) {
  console.error(err);
  const status = err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ error: err.message });
}

// READ: anyone with the link can read it as plain text
app.get('/handoff', async (req, res) => {
  try {
    const f = await getFile();
    if (!f) return res.type('text/plain').send('No handoff yet.');
    res.type('text/plain').send(f.content);
  } catch (err) { fail(res, err); }
});

// CREATE or UPDATE (replaces the whole file)
app.put('/handoff', async (req, res) => {
  if (!checkKey(req, res)) return;
  const content = typeof req.body === 'string' ? req.body : req.body?.content;
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Send the full handoff as text.' });
  }
  try {
    const existing = await getFile();
    await gh.repos.createOrUpdateFileContents({
      owner: OWNER, repo: REPO, path: FILE, branch: BRANCH,
      message: existing ? 'Update handoff' : 'Create handoff',
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha: existing ? existing.sha : undefined,
    });
    res.json({ ok: true, action: existing ? 'updated' : 'created' });
  } catch (err) { fail(res, err); }
});

// DELETE
app.delete('/handoff', async (req, res) => {
  if (!checkKey(req, res)) return;
  try {
    const existing = await getFile();
    if (!existing) return res.status(404).json({ error: 'No handoff to delete.' });
    await gh.repos.deleteFile({
      owner: OWNER, repo: REPO, path: FILE, branch: BRANCH,
      sha: existing.sha, message: 'Delete handoff',
    });
    res.json({ ok: true, action: 'deleted' });
  } catch (err) { fail(res, err); }
});

app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`handoff memory running on port ${PORT}`));
