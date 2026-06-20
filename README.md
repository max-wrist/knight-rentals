# Knight Rentals

Knight Rentals is a Node.js rental-management MVP with a WhatsApp tenant agent, Firestore storage, admin APIs, text receipts, maintenance tracking, and a mobile-first dashboard for Android Chrome.

## What it does

- Tenants can send `balance`, `receipt`, `pay`, or `report issue leaking pipe` on WhatsApp.
- Registered landlords can send `arrears` on WhatsApp.
- Admins can create properties, units, and tenants; record payments; view arrears and vacancies; and manage maintenance tickets.
- Payments update the tenant balance in a Firestore transaction and immediately generate a text receipt.
- WhatsApp message IDs are stored to prevent duplicate webhook deliveries from creating duplicate tickets.

## Project structure

```text
.
├── public/
│   ├── admin.js             Mobile dashboard behavior
│   ├── index.html           Admin dashboard
│   └── styles.css           Responsive Android-friendly styles
├── routes/
│   ├── maintenance.js       Complaint creation and status tracking
│   ├── payments.js          Payment ledger, receipts, and arrears
│   ├── properties.js        Property APIs
│   ├── tenants.js           Tenant APIs and phone lookup
│   └── units.js             Unit and vacancy APIs
├── .env.example
├── firebase.js
├── package.json
├── server.js
└── whatsapp.js
```

## Firestore data model

Firestore collections are created automatically on the first write.

```text
properties/{propertyId}
  name, address, landlordName, paymentInstructions, createdAt, updatedAt

units/{unitId}
  propertyId, propertyName, name, monthlyRent, description
  status: "vacant" | "occupied", tenantId, createdAt, updatedAt

tenants/{tenantId}
  name, phone, email, propertyId, propertyName, unitId, unitName
  monthlyRent, balance, currency, status: "active", createdAt, updatedAt

payments/{paymentId}
  tenantId, tenantName, propertyId, propertyName, unitId, unitName
  receiptNumber, amount, currency, method, reference, notes
  balanceBefore, balanceAfter, paymentDate, createdAt

maintenance/{ticketId}
  ticketNumber, tenantId, tenantName, tenantPhone, propertyId, propertyName
  unitId, unitName, description, priority
  status: "open" | "in_progress" | "resolved" | "closed"
  adminNotes, createdAt, updatedAt, resolvedAt

admins/{adminId}
  name, phone, active

processedMessages/{whatsappMessageId}
  createdAt
```

Phone numbers are stored as digits only, including the country code—for example, `254712345678`. The `balance` field is the current amount due; a negative value represents tenant credit. Recording a payment reduces it transactionally. For this MVP, add monthly rent charges to `balance` through your billing process or the Firebase console; scheduled monthly invoicing is a natural next step.

## Local setup

Requirements: Node.js 18+, a Firebase project with Firestore enabled, and a Meta app with WhatsApp Cloud API configured.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the values:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell, use `Copy-Item .env.example .env`.

3. In Firebase Console, open **Project settings → Service accounts**, generate a private key, and copy `project_id`, `client_email`, and `private_key` into the matching variables. Keep the private key wrapped in quotes and retain its `\n` sequences.

4. Start the app:

   ```bash
   npm start
   ```

5. Open `http://localhost:3000` in Chrome. The health check is at `http://localhost:3000/health`.

For automatic restarts during development, use `npm run dev`. Run `npm run check` for JavaScript syntax checks.

## WhatsApp Cloud API setup

1. In Meta for Developers, create or open an app and add the WhatsApp product.
2. Copy the access token and phone-number ID into `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`. Use a permanent system-user token for production.
3. Choose a private string for `WHATSAPP_VERIFY_TOKEN`.
4. Expose the local server with an HTTPS tunnel such as ngrok or Cloudflare Tunnel.
5. In WhatsApp **Configuration**, set the callback URL to `https://YOUR-DOMAIN/webhook`, enter the same verify token, and subscribe to the `messages` webhook field.
6. Add each tenant using the dashboard with the same full international phone number they use on WhatsApp.
7. To enable the landlord-only `arrears` WhatsApp command, create a Firestore document in `admins`, for example:

   ```json
   {
     "name": "Property Manager",
     "phone": "254712345678",
     "active": true
   }
   ```

Meta sends webhook verification to `GET /webhook` and message events to `POST /webhook`. A plain browser request to the POST endpoint is not a valid test; use Meta's test tools or send a WhatsApp message to the configured business number.

## Admin API

Set `ADMIN_API_KEY` in production. When it is set, every `/api` request must include `x-admin-api-key`; the dashboard's **API key** button stores it locally in that browser.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/properties` | Add property |
| `GET` | `/api/properties` | List properties |
| `POST` | `/api/units` | Add unit |
| `GET` | `/api/units` | List units; optionally filter with `?propertyId=` |
| `GET` | `/api/units/vacant` | View vacant units |
| `POST` | `/api/tenants` | Add tenant and occupy their unit |
| `GET` | `/api/tenants` | List tenants |
| `POST` | `/api/payments` | Record payment and return text receipt |
| `GET` | `/api/payments` | List payments; optionally filter with `?tenantId=` |
| `GET` | `/api/payments/arrears` | View tenants with balances due |
| `POST` | `/api/maintenance` | Create a ticket for a tenant |
| `GET` | `/api/maintenance` | List tickets; optionally filter with `?status=` |
| `PATCH` | `/api/maintenance/:id` | Update status, priority, or admin notes |

Example payment request:

```bash
curl -X POST http://localhost:3000/api/payments \
  -H "Content-Type: application/json" \
  -H "x-admin-api-key: YOUR_KEY" \
  -d '{"tenantId":"TENANT_ID","amount":25000,"method":"M-Pesa","reference":"QH12ABCDEF"}'
```

## Deploy to Render

1. Push this folder to a GitHub repository.
2. In Render, create a **Web Service** from the repository.
3. Use `npm install` as the build command and `npm start` as the start command. The app reads Render's assigned `PORT` automatically.
4. Add every variable from `.env.example` under the service's environment settings. Paste `FIREBASE_PRIVATE_KEY` as one value with `\n` line breaks.
5. Deploy and verify `https://YOUR-SERVICE.onrender.com/health`.
6. Set Meta's callback URL to `https://YOUR-SERVICE.onrender.com/webhook`.

See Render's [Node.js deployment guide](https://render.com/docs/deploy-node-express-app) and [environment variable documentation](https://render.com/docs/configure-environment-variables).

## Deploy to Railway

1. Push the project to GitHub, create a Railway project, and choose **Deploy from GitHub repo**.
2. Railway detects the Node.js app and runs `npm start`. If needed, set the start command explicitly in service settings.
3. Add every `.env.example` value under **Variables**.
4. In **Networking**, generate a public domain.
5. Verify `https://YOUR-DOMAIN/health`, then use `https://YOUR-DOMAIN/webhook` as Meta's callback URL.

See Railway's [Express deployment guide](https://docs.railway.com/guides/express) and [variables guide](https://docs.railway.com/guides/variables).

## Production notes

- Never commit `.env` or a Firebase service-account key. Rotate any credential that is exposed.
- Keep `ADMIN_API_KEY` enabled on a public deployment. For a larger team, replace it with Firebase Authentication and role-based access.
- Add Meta webhook signature verification with the app secret before handling high-risk workflows.
- The current receipt is intentionally text-first for reliable WhatsApp delivery. A later PDF implementation can render the same payment record, store the PDF in Cloud Storage, and send it as a WhatsApp document message.
- Add a scheduled monthly billing job and immutable charge ledger before using balances for formal accounting.
