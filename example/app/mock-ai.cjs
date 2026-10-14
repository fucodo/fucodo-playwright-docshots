// Mock OpenAI-compatible API for testing `docshots from-image` without a real model.
// 1st answer: deliberately wrong button name → dry run fails → 2nd answer: corrected.
const http = require('node:http');
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const r = JSON.parse(body);
    const images = r.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'image_url').length;
    const isRepair = r.messages.some((m) => m.role === 'assistant');
    const prompt = JSON.stringify(r.messages);
    console.error(`[mock-ai] model=${r.model} json=${!!r.response_format} messages=${r.messages.length} images=${images} aria=${prompt.includes('button')} repair=${isRepair} auth=${!!req.headers.authorization}`);
    const steps = [
      `Wenn ich auf den Button "${isRepair ? 'Neue Person' : 'Neuer Benutzer'}" klicke`,
      'Und ich fülle das Feld "Vorname" mit "Max" aus',
      'Und ich gebe "Muster" in das Feld "Nachname" ein',
      'Dann markiere das Feld "Vorname" mit "1"',
      'Und markiere das Feld "E-Mail" mit "2" und Hinweis "Pflichtfeld"',
      'markiere den Button "Speichern" mit "3"',          // missing keyword on purpose
      'Und erstelle einen Screenshot vom Formular "Person anlegen"',
    ];
    const content = '```json\n' + JSON.stringify({ steps, notes: isRepair ? ['Der Button heißt heute "Neue Person" statt "Neuer Benutzer".'] : [] }) + '\n```';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  });
}).listen(4318, () => console.error('[mock-ai] on 4318'));
