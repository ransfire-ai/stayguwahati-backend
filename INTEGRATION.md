# Add the Google Places endpoint to stayguwahati-backend

Your frontend is deployed on Vercel and your existing API is deployed on Render. The frontend should **not** hold the Google Places API key.

## 1. Copy the route

Copy `nearbyFoodRoute.js` into your existing Express backend, for example:

`routes/nearbyFoodRoute.js`

## 2. Mount it in the existing Express app

Near your other route imports:

```js
const nearbyFoodRoute = require("./routes/nearbyFoodRoute");
```

Then, after `const app = express()` and before `app.listen(...)`:

```js
app.use("/api/places", nearbyFoodRoute);
```

If your routes folder has a different path, keep the same router code and adjust only the `require` path.

## 3. Add these Render environment variables

On the `stayguwahati-backend` service:

```text
GOOGLE_MAPS_API_KEY=YOUR_GOOGLE_SERVER_KEY
STAYGUWAHATI_PLACES_PROXY_SECRET=YOUR_LONG_RANDOM_SECRET
```

Do not put either value in frontend code and do not use `NEXT_PUBLIC_` for them.

## 4. Add the same proxy secret to Vercel

On the StayGuwahati Vercel project, add:

```text
STAYGUWAHATI_PLACES_PROXY_SECRET=THE_SAME_LONG_RANDOM_SECRET
STAYGUWAHATI_BACKEND_URL=https://stayguwahati-backend.onrender.com
```

The Google key is **not** added to Vercel.

## 5. Generate a secret

Use a long random value, for example a 32+ character random string. Do not use the example above as an actual secret.

## 6. Endpoint

The frontend calls:

`GET /api/places/nearby-food?slug=uzan-bazar`

The backend accepts only these seven slugs:

- `uzan-bazar`
- `paltan-bazar`
- `ganeshguri`
- `maligaon`
- `chandmari`
- `panjabari`
- `six-mile`

The server supplies the coordinates/radius itself, so callers cannot use this endpoint as an arbitrary Google Places proxy.

## 7. Google API key restriction

Once the backend is deployed and working, restrict the Google server key to:

- Application restriction: **IP addresses**
- API restriction: **Places API (New)**

Use the complete outbound CIDR ranges shown by Render at:

`stayguwahati-backend` → **Connect** → **Outbound**

Do not guess the ranges. Render states that a service can use any IP within its assigned CIDR ranges.
