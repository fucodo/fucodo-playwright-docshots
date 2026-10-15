// Tiny mock application for the example – stands in for your real app.
// Language via Accept-Language, dark mode via prefers-color-scheme, responsive layout.
const http = require('node:http');

const T = {
  de: { login: 'Anmelden', user: 'Benutzername', pass: 'Passwort', persons: 'Personen', home: 'Start', newPerson: 'Neue Person',
        createPerson: 'Person anlegen', first: 'Vorname', last: 'Nachname', mail: 'E-Mail', role: 'Rolle', active: 'Aktiv',
        save: 'Speichern', cancel: 'Abbrechen', teacher: 'Lehrkraft', admin: 'Schuladministration', welcome: 'Willkommen', help: 'Hilfe',
        created: 'Angelegt' },
  en: { login: 'Log in', user: 'Username', pass: 'Password', persons: 'Persons', home: 'Home', newPerson: 'New person',
        createPerson: 'Create person', first: 'First name', last: 'Last name', mail: 'Email', role: 'Role', active: 'Active',
        save: 'Save', cancel: 'Cancel', teacher: 'Teacher', admin: 'School administration', welcome: 'Welcome', help: 'Help',
        created: 'Created' },
};

const people = [
  ['Anna', 'Becker', 'anna.becker@schule.example', 'teacher', '2026-08-30'],
  ['Jonas', 'Krüger', 'jonas.krueger@schule.example', 'admin', '2026-09-02'],
  ['Mira', 'Schulz', 'mira.schulz@schule.example', 'teacher', '2026-09-14'],
];

const css = `
:root{--bg:#f6f7f9;--fg:#1d2330;--card:#fff;--line:#dfe3ea;--brand:#b30d26;--muted:#5d6678}
@media (prefers-color-scheme:dark){:root{--bg:#14171d;--fg:#e8ebf1;--card:#1d222b;--line:#2f3642;--brand:#ff5a6e;--muted:#9aa3b5}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;gap:24px;align-items:center;padding:12px 24px;background:var(--brand);color:#fff}
header a{color:#fff;text-decoration:none;font-weight:600}header .logo{font-weight:800;margin-right:auto}
main{max-width:960px;margin:24px auto;padding:0 16px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px}
h1{margin:0 0 16px;font-size:22px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line)}
td.mail{color:var(--muted)}button{font:inherit;border:0;border-radius:6px;padding:8px 14px;cursor:pointer}
.primary{background:var(--brand);color:#fff}.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}
.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
label{display:block;font-weight:600;margin:12px 0 4px}input,select{width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
.check{display:flex;gap:8px;align-items:center;font-weight:600;margin-top:12px}.check input{width:auto}
dialog{border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--fg);width:min(480px,92vw);padding:24px}
dialog::backdrop{background:rgba(0,0,0,.45)}.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
.login{max-width:380px;margin:12vh auto}
@media (max-width:640px){header{flex-wrap:wrap;gap:12px}td.mail,th.mail{display:none}main{margin:12px auto}}
`;

const lang = (req) => (/^en/i.test(req.headers['accept-language'] || '') ? 'en' : 'de');
const page = (l, title, body, nav = true) => `<!doctype html><html lang="${l}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style></head><body>
${nav ? `<header><span class="logo">Schulportal</span><nav aria-label="Hauptmenü" style="display:flex;gap:16px"><a href="/">${T[l].home}</a><a href="/administration/persons">${T[l].persons}</a><a href="#">${T[l].help}</a></nav></header>` : ''}
<main>${body}</main></body></html>`;

http.createServer((req, res) => {
  const l = lang(req);
  const t = T[l];
  const loggedIn = /session=ok/.test(req.headers.cookie || '');
  const send = (html, status = 200, headers = {}) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers }); res.end(html); };

  if (req.url === '/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = new URLSearchParams(body);
      if (p.get('password') === 'secret-' + p.get('username')) return send('', 303, { location: '/', 'set-cookie': 'session=ok; Path=/' });
      return send('', 303, { location: '/login?error=1' });
    });
    return;
  }
  if (req.url.startsWith('/login')) {
    return send(page(l, t.login, `<div class="card login"><h1>${t.login}</h1>
      <form method="post" action="/login"><label for="username">${t.user}</label><input id="username" name="username" autocomplete="username">
      <label for="password">${t.pass}</label><input id="password" name="password" type="password">
      <div class="actions"><button class="primary" type="submit" id="login-submit">${t.login}</button></div></form></div>`, false));
  }
  if (!loggedIn) return send('', 303, { location: '/login' });

  if (req.url === '/') return send(page(l, t.home, `<div class="card"><h1>${t.welcome}</h1><p>Schuljahr 2026/27</p></div>`));
  if (req.url === '/administration/persons') {
    const rows = people.map(([f, la, m, r, d]) => `<tr><td>${f} ${la}</td><td class="mail">${m}</td><td>${t[r]}</td><td>${d}</td></tr>`).join('');
    return send(page(l, t.persons, `<div class="card"><div class="toolbar"><h1>${t.persons}</h1>
      <button class="primary" onclick="document.getElementById('dlg').showModal()">${t.newPerson}</button></div>
      <table><thead><tr><th>Name</th><th class="mail">${t.mail}</th><th>${t.role}</th><th>${t.created}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <dialog id="dlg" aria-labelledby="dlg-title"><h1 id="dlg-title">${t.createPerson}</h1>
      <form id="person-form" method="dialog"><label for="f">${t.first}</label><input id="f">
      <label for="la">${t.last}</label><input id="la"><label for="m">${t.mail}</label><input id="m" type="email">
      <label for="r">${t.role}</label><select id="r"><option>${t.teacher}</option><option>${t.admin}</option></select>
      <label class="check"><input type="checkbox" checked> ${t.active}</label>
      <div class="actions"><button class="ghost" value="cancel">${t.cancel}</button><button class="primary" value="save">${t.save}</button></div></form></dialog>`));
  }
  if (req.url === '/status-app') {
    // app-shell layout: the page does not scroll, an inner content area does – and smooth scrolling is on
    const services = Array.from({ length: 50 }, (_, i) => `<tr><td>Dienst ${i + 1}</td><td style="color:#1a7f37">● verfügbar</td></tr>`).join('');
    return send(`<!doctype html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Status (App)</title><style>${css}
        html,body{height:100%;overflow:hidden;scroll-behavior:smooth}
        .shell{display:flex;flex-direction:column;height:100%}
        .content{flex:1;overflow:auto;scroll-behavior:smooth}
      </style></head><body><div class="shell">
      <header><span class="logo">Status-App</span><nav aria-label="Hauptmenü" style="display:flex;gap:16px"><a href="#">Ereignisse</a><a href="/impressum">Impressum</a></nav></header>
      <div class="content"><main><div class="card"><h1>Dienste-Status</h1><table>${services}</table></div></main>
      <footer style="max-width:960px;margin:32px auto;padding:0 16px;color:var(--muted);font-size:14px;display:flex;gap:24px">
        <span>RSS abonnieren: <a href="/index.xml">alle Updates</a></span><a href="/impressum">Impressum</a>
      </footer></div></div></body></html>`);
  }
  if (req.url === '/status') {
    // long page like status.schullogin.de – feed links in the footer, "Impressum" twice (header + footer)
    const services = Array.from({ length: 50 }, (_, i) => `<tr><td>Dienst ${i + 1}</td><td style="color:#1a7f37">● verfügbar</td></tr>`).join('');
    return send(`<!doctype html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Status</title><style>${css} html{scroll-behavior:smooth}</style></head><body>
      <header><span class="logo">Status</span><nav aria-label="Hauptmenü" style="display:flex;gap:16px"><a href="#">Ereignisse</a><a href="/impressum">Impressum</a></nav></header>
      <main><div class="card"><h1>Dienste-Status</h1><table>${services}</table></div></main>
      <footer style="max-width:960px;margin:32px auto;padding:0 16px;color:var(--muted);font-size:14px;display:flex;flex-wrap:wrap;gap:8px 24px">
        <a href="#" style="color:inherit">Nach oben</a>
        <span class="feeds">RSS abonnieren: <a href="/index.xml">alle Updates</a> · Kalender abonnieren: <a href="/issues.ics">alle Ereignisse</a></span>
        <a href="/impressum">Impressum</a>
        <span>© Verfügbarkeit digitaler Dienste, 2026</span>
      </footer></body></html>`);
  }
  if (req.url === '/stress') {
    // deliberately hard layout for the annotation solver: corners, a tight cluster, fields close by
    const btn = (label, style) => `<button class="primary" style="position:absolute;${style}">${label}</button>`;
    return send(page(l, 'Stress', `
      <div style="position:relative;height:calc(100vh - 110px);min-height:520px">
        ${btn('Ecke links', 'left:0;top:0')}
        ${btn('Ecke rechts', 'right:0;top:0')}
        ${btn('Unten links', 'left:0;bottom:0')}
        ${btn('Unten rechts', 'right:0;bottom:0')}
        <div style="position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);display:flex;gap:8px">
          <button class="primary">Eins</button><button class="primary">Zwei</button><button class="primary">Drei</button>
        </div>
        <div class="card" style="position:absolute;left:50%;top:62%;transform:translateX(-50%);width:min(420px,90%)">
          <label for="s1">Suchbegriff</label><input id="s1"><label for="s2">Kategorie</label><input id="s2">
        </div>
      </div>`));
  }
  send('Not found', 404);
}).listen(Number(process.env.PORT || 4317), () => console.log('mock app on', process.env.PORT || 4317));
