# WhatsApp Auction Backend

A purpose-built backend for a WhatsApp auction group that captures bids, stores them, sends real-time bidder updates, and closes lots automatically.

## Features

- Captures bid messages from WhatsApp Business API webhook events
- Stores bids with timestamp, bidder ID, amount, and item reference
- Sends immediate "highest bidder" or "outbid" alerts via WhatsApp
- Extends auction time by 10 seconds per bid
- Automatically closes lots at end time and announces winners in group
- Sends private payment instructions to winners
- Admin endpoints for adding items and manual overrides

## Quick setup

1. Install dependencies

```bash
npm install
```

2. Create `.env` from `.env.example`

```bash
copy .env.example .env
```

3. Set required environment variables:

- `MONGODB_URI`
- `WHATSAPP_API_URL`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_GROUP_ID`
- `ADMIN_PHONE_NUMBER`
- `ADMIN_SECRET`

4. Start the server

```bash
npm start
```

Or during development:

```bash
npm run dev
```

## API endpoints

### Webhook endpoint

- `POST /webhook` — receive WhatsApp Business API webhook events

### Admin endpoints

- `POST /admin/items` — add a new auction item
- `POST /admin/override` — manually close or extend an auction item

## Add new auction items

Use the admin endpoint:

```bash
curl -X POST http://localhost:3000/admin/items \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_admin_secret" \
  -d '{
    "reference": "LOT1",
    "title": "Antique Vase",
    "startAmount": 100,
    "endTime": "2026-07-11T12:00:00Z",
    "groupId": "<WHATSAPP_GROUP_ID>"
  }'
```

## Manual overrides

To close a lot immediately or extend an end time manually:

```bash
curl -X POST http://localhost:3000/admin/override \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_admin_secret" \
  -d '{
    "reference": "LOT1",
    "action": "close"
  }'
```

To extend:

```bash
curl -X POST http://localhost:3000/admin/override \
  -H "Content-Type: application/json" \
  -d '{
    "reference": "LOT1",
    "action": "extend",
    "seconds": 30
  }'
```

## WhatsApp integration

Configure your WhatsApp Business API webhook to point at:

```text
https://<your-domain>/webhook
```

The backend understands standard text messages and expects bid messages in one of these formats:

- `LOT1 100`
- `bid LOT1 100`
- `#LOT1 100`

The app sends bidder alerts and group announcements using the configured WhatsApp API URL.

## Deployment

Recommended deployment options:

- AWS Elastic Beanstalk or ECS
- DigitalOcean App Platform
- GCP Cloud Run

Ensure your service is reachable over HTTPS and the webhook URL is registered in your WhatsApp Business API settings.
