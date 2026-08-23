# StayGuwahati – Complete Guest Booking Flow

Flow:

Property Details
  -> Book Stay (select dates + guests)
  -> Checkout / Guest Details
  -> POST /api/bookings
  -> Booking Confirmation
  -> Host accepts/rejects
  -> Confirmation page automatically refreshes status
  -> Guest dashboard

Included:
- app/property-details/page.tsx
- app/book-stay/page.tsx
- app/checkout/page.tsx
- app/booking-confirmation/page.tsx
- server_booking_flow_updated.js

Important:
1. The checkout does NOT collect online payment. It creates a Requested booking.
2. The server recalculates nights and total price; the browser total is only a preview.
3. The server blocks overlapping Requested/Confirmed bookings.
4. Host approval changes Requested -> Confirmed or Rejected.
5. The confirmation page polls every 30 seconds for status changes.
6. Set NEXT_PUBLIC_BACKEND_URL (or NEXT_PUBLIC_API_URL) to your backend URL.
7. The backend needs the existing Booking/Homestay/User models and environment variables.
