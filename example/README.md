# Example project

Mirrors a typical structure (`Tests/Playwright/pages`, `fixtures`, `index.ts`, `@playwright-common` alias)
with a tiny mock app (`app/server.cjs`), so the whole pipeline can be run locally.

```bash
cd ..  && npm install && npm pack          # builds fucodo-playwright-docshots-0.1.0.tgz
cd example && npm install
npx playwright install chromium            # or: export PW_CHROMIUM_PATH=/path/to/chrome
export DOCSHOT_PW_SCHOOLADMIN=secret-doc-schooladmin   # the mock app accepts "secret-<username>"
npx docshots lint
npx docshots test
```

The package is installed from the packed tarball, not via `file:..`. A symlinked package would load a second
copy of `@playwright/test` from the package's own `node_modules`, which Playwright refuses.

Where to look:
- `Documentation/Admin/Persons.rst`: embedded steps (German); `Persons.en.rst`: English
- `Documentation/Screenshots/person-create-flow.feature`: separate feature file with Grundlage + 2 shots
- `Tests/Playwright/docshots/steps/index.ts`: login adapter, areas, merged test
- `Documentation/Images/Screenshots/`: results of the last run

## Converting an old screenshot

```bash
cp .env.example .env && node app/mock-ai.cjs &      # or put a real API key into .env
npx docshots from-image Documentation/Images/Legacy/person-form.png --url /administration/persons --persona schooladmin --insert
```

The mock deliberately answers with a wrong button name first, so you can see the repair round.
