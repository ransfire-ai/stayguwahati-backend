// Required backend patch for ID-only host profile URLs.
// Current Homestay documents store host.email but not the User _id.
// This enriches public listing responses with host.hostId without exposing email.

async function attachPublicHostId(listing) {
  if (!listing?.host) return listing;
  const email = String(listing.host.email || '').trim().toLowerCase();
  if (!email) return listing;

  const user = await User.findOne({ email }, { _id: 1 }).lean();
  if (user?._id) {
    listing.host = { ...listing.host, hostId: String(user._id) };
  }
  return listing;
}

// In GET /api/homestays, after `listings` is loaded with .lean():
for (const listing of listings) {
  await attachPublicHostId(listing);
}

// In GET /api/homestays/:id, after the single homestay is loaded with .lean():
await attachPublicHostId(homestay);

// Recommended long-term schema field:
// host: {
//   hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
//   ...existing host fields...
// }
// Then save hostId when creating/updating a listing so the User lookup above
// is only needed for legacy records.
