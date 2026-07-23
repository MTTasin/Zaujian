// cPanel / Passenger Node entrypoint for the Next.js storefront.
// Requires a production build first: `npm run build` (with NEXT_PUBLIC_* set).
const { createServer } = require("http");
const next = require("next");

const port = process.env.PORT || 3000;
const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => handle(req, res)).listen(port, () => {
    console.log(`Zaujain storefront ready on port ${port}`);
  });
});
