# Instagram REST API Integration Guide — `@thesimplekrew`

This document contains everything needed to integrate the `@thesimplekrew` Instagram account into your CRM, backend service, website, or webhook automation without exposing master admin credentials.

---

## 1. Credentials & Configuration

| Parameter | Value | Description |
| :--- | :--- | :--- |
| **Base URL** | `https://instagramagentmcp-vercel.vercel.app` | Production API Host |
| **API Key** | `ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI` | Dedicated scoped Bearer token |
| **Target Account** | `thesimplekrew` | Instagram username |
| **Instagram User ID** | `17841473862462897` | Permanent Meta IG User ID |
| **Auth Header** | `Authorization: Bearer <API_KEY>` | Standard HTTP Header |
| **Interactive Admin** | `https://instagramagentmcp-vercel.vercel.app/admin` | Key & account management |
| **OpenAPI Schema** | `https://instagramagentmcp-vercel.vercel.app/api/openapi.json` | Swagger/Postman compatible |

---

## 2. Security & Account Isolation Guarantees

- **Account-Locked**: This key is cryptographically restricted in Firebase RTDB to `@thesimplekrew`.
- **Cross-Account Blocking**: If a request attempts to query or post to any other account (e.g., `@strucureo` or `@print_.trek`), the API immediately responds with `403 Forbidden`:
  ```json
  { "ok": false, "error": "Forbidden: This API key is restricted to account @thesimplekrew." }
  ```
- **Admin Isolation**: This key cannot access any `/api/admin/*` routes or modify server settings.
- **Instant Revocation**: If compromised, revoke this key instantly from the [Admin Studio Dashboard](https://instagramagentmcp-vercel.vercel.app/admin).

---

## 3. Quick Start with CLI Scripts

Two ready-to-run scripts are included in this repository:

### Windows (`thesimplekrew_crm.cmd`)
```cmd
:: Get account details
thesimplekrew_crm.cmd info

:: Fetch last 5 posts
thesimplekrew_crm.cmd media

:: Publish a photo
thesimplekrew_crm.cmd post "https://example.com/photo.jpg" "Hello from CRM! 🚀"

:: Generate AI image and publish
thesimplekrew_crm.cmd generate "minimalist streetwear editorial photography" "Drop coming soon."
```

### macOS / Linux (`thesimplekrew_crm.sh`)
```bash
chmod +x thesimplekrew_crm.sh

./thesimplekrew_crm.sh info
./thesimplekrew_crm.sh media
./thesimplekrew_crm.sh post "https://example.com/photo.jpg" "Hello from CRM! 🚀"
./thesimplekrew_crm.sh generate "minimalist streetwear editorial photography" "Drop coming soon."
```

---

## 4. API Endpoints Reference

All requests must include the header:
```http
Authorization: Bearer ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI
```

---

### Endpoint 1: Get Account Profile
Returns account details, username, follower count, and media count for `@thesimplekrew`.

- **Method**: `GET`
- **Path**: `/api/rest/me?account=thesimplekrew`

#### cURL
```bash
curl -s -X GET "https://instagramagentmcp-vercel.vercel.app/api/rest/me?account=thesimplekrew" \
  -H "Authorization: Bearer ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI"
```

#### Example Response (200 OK)
```json
{
  "ok": true,
  "account": {
    "id": "17841473862462897",
    "username": "thesimplekrew",
    "name": "The Simple Krew",
    "account_type": "BUSINESS",
    "media_count": 42,
    "followers_count": 1280
  }
}
```

---

### Endpoint 2: List Recent Media
Fetches published posts, permalinks, captions, timestamps, and engagement counts.

- **Method**: `GET`
- **Path**: `/api/rest/media?account=thesimplekrew&limit=10`
- **Query Parameters**:
  - `account` *(optional)*: `"thesimplekrew"` (defaults automatically to your scoped account)
  - `limit` *(optional)*: Integer between `1` and `50` (default `10`)

#### cURL
```bash
curl -s -X GET "https://instagramagentmcp-vercel.vercel.app/api/rest/media?account=thesimplekrew&limit=5" \
  -H "Authorization: Bearer ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI"
```

#### Example Response (200 OK)
```json
{
  "ok": true,
  "media": [
    {
      "id": "18012345678901234",
      "caption": "Latest streetwear drops 💥",
      "media_type": "IMAGE",
      "media_url": "https://scontent...",
      "permalink": "https://www.instagram.com/p/CXYZ123/",
      "timestamp": "2026-10-20T14:30:00+0000",
      "like_count": 87,
      "comments_count": 12
    }
  ]
}
```

---

### Endpoint 3: Get Media Insights
Returns detailed engagement metrics for a specific published post.

- **Method**: `GET`
- **Path**: `/api/rest/insights?account=thesimplekrew&media_id=<MEDIA_ID>`

#### cURL
```bash
curl -s -X GET "https://instagramagentmcp-vercel.vercel.app/api/rest/insights?account=thesimplekrew&media_id=18012345678901234" \
  -H "Authorization: Bearer ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI"
```

#### Example Response (200 OK)
```json
{
  "ok": true,
  "insights": {
    "impressions": 1420,
    "reach": 1180,
    "saved": 34,
    "shares": 19,
    "total_interactions": 152
  }
}
```

---

### Endpoint 4: Publish a Photo Post
Publishes an image directly to the `@thesimplekrew` feed with a caption.

- **Method**: `POST`
- **Path**: `/api/rest/post`
- **Headers**:
  - `Authorization: Bearer ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI`
  - `Content-Type: application/json`
- **Body Fields**:
  - `image_url` *(required)*: Publicly accessible URL (`https://...`) of the JPEG/PNG image.
  - `caption` *(optional)*: Post text, hashtags, and mentions.
  - `account` *(optional)*: `"thesimplekrew"`

#### cURL
```bash
curl -s -X POST "https://instagramagentmcp-vercel.vercel.app/api/rest/post" \
  -H "Authorization: Bearer ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "thesimplekrew",
    "image_url": "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=1080&q=80",
    "caption": "Elevating the everyday wardrobe. New drop live now! 🖤 #thesimplekrew #streetwear"
  }'
```

#### Example Response (200 OK)
```json
{
  "ok": true,
  "id": "18099887766554433",
  "post_id": "18099887766554433",
  "account": "thesimplekrew",
  "remaining_today": 94
}
```

---

### Endpoint 5: Generate AI Image and Post
Generates an image via Pollinations AI using your text prompt, and publishes it straight to `@thesimplekrew`.

- **Method**: `POST`
- **Path**: `/api/rest/generate-and-post`
- **Headers**:
  - `Authorization: Bearer ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI`
  - `Content-Type: application/json`
- **Body Fields**:
  - `prompt` *(required)*: Image description for the AI image generator.
  - `caption` *(required)*: Caption to be published with the image.
  - `account` *(optional)*: `"thesimplekrew"`

#### cURL
```bash
curl -s -X POST "https://instagramagentmcp-vercel.vercel.app/api/rest/generate-and-post" \
  -H "Authorization: Bearer ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "thesimplekrew",
    "prompt": "futuristic monochrome streetwear jacket, dramatic studio shadows, 8k editorial look",
    "caption": "Sneak peek into the concept vault. What do you think? 🔥 #thesimplekrew"
  }'
```

---

## 5. Code Integration Examples

### Node.js / JavaScript (Fetch)
```javascript
const API_BASE = "https://instagramagentmcp-vercel.vercel.app";
const API_KEY = "ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI";

async function publishPost(imageUrl, caption) {
  const res = await fetch(`${API_BASE}/api/rest/post`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      account: "thesimplekrew",
      image_url: imageUrl,
      caption: caption
    })
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  console.log("Published! Post ID:", data.post_id);
  return data;
}

// Example usage:
publishPost(
  "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=1080&q=80",
  "Automated order confirmation showcase 🚀 #thesimplekrew"
);
```

---

### Python (Requests)
```python
import requests

API_BASE = "https://instagramagentmcp-vercel.vercel.app"
API_KEY = "ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

def publish_instagram_photo(image_url: str, caption: str):
    url = f"{API_BASE}/api/rest/post"
    payload = {
        "account": "thesimplekrew",
        "image_url": image_url,
        "caption": caption
    }
    response = requests.post(url, json=payload, headers=headers)
    data = response.json()
    if not data.get("ok"):
        raise Exception(f"Failed to post: {data.get('error')}")
    print(f"Success! Post ID: {data.get('post_id')}")
    return data

# Example usage:
publish_instagram_photo(
    "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=1080&q=80",
    "Posted automatically from our Python backend 🐍 #thesimplekrew"
)
```

---

### PHP (cURL)
```php
<?php
$apiKey = "ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI";
$url = "https://instagramagentmcp-vercel.vercel.app/api/rest/post";

$payload = json_encode([
    "account"   => "thesimplekrew",
    "image_url" => "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=1080&q=80",
    "caption"   => "Automated post from PHP CRM 🐘 #thesimplekrew"
]);

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer " . $apiKey,
    "Content-Type: application/json"
]);

$response = curl_exec($ch);
curl_close($ch);

echo $response;
?>
```

---

### Zapier / Make / Webhook Automation

When setting up a webhook action in Zapier, Make.com, or n8n:
- **Action**: Custom Webhook (POST)
- **URL**: `https://instagramagentmcp-vercel.vercel.app/api/rest/post`
- **Headers**:
  - `Authorization`: `Bearer ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI`
  - `Content-Type`: `application/json`
- **Body Data**:
  ```json
  {
    "account": "thesimplekrew",
    "image_url": "{{trigger.image_url}}",
    "caption": "{{trigger.caption}}"
  }
  ```

---

## 6. Token Maintenance & Troubleshooting

| Error Code | Cause | Solution |
| :--- | :--- | :--- |
| **`401 Unauthorized`** | Missing or incorrect `Authorization` header. | Verify key starts with `ig_live_` and is passed as `Bearer ig_live_...`. |
| **`403 Forbidden`** | Attempting to access an account other than `@thesimplekrew`. | Ensure `account` parameter is `thesimplekrew` or omitted. |
| **`ERROR 190 (subcode 463)`** | Meta Graph API user access token has expired (Meta tokens expire every 60 days). | 1. Open [Admin Studio](https://instagramagentmcp-vercel.vercel.app/admin)<br>2. Log in with Admin Password<br>3. Click **"Log In with Meta / Facebook"** to grant a fresh long-lived token. |
| **`429 Too Many Requests`** | Daily safety budget cap reached (default: 95 posts/day). | Modify custom daily cap in Admin Studio under **⚙️ Controls**. |
