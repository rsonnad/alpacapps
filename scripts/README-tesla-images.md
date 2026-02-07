# Tesla Vehicle Image Updates

## Issue
The cars page (`residents/cars.html`) was showing SVG wireframe silhouettes instead of real car photos because the `image_url` field in the `tesla_vehicles` table was empty.

## Fix Applied
Updated all 6 vehicles with stock Tesla photos from Unsplash as temporary placeholders:

- **Casper** (2019 Model 3, White) - Generic white Model 3 photo
- **Delphi** (2023 Model Y, White) - Generic white Model Y photo
- **Sloop** (2026 Model Y, White) - Generic white Model Y photo
- **Cygnus** (2026 Model Y, Grey) - Generic grey Model Y photo
- **Kimba** (2022 Model Y, White) - Generic white Model Y photo
- **Brisa Branca** (2022 Model 3, White) - Generic white Model 3 photo

## Scripts Created

### `update-tesla-images.js`
Node.js script that updates the `image_url` field for all vehicles in the database. Run with:
```bash
node scripts/update-tesla-images.js
```

### `update-tesla-images.sql`
SQL migration file for reference (not needed if using the JS script).

### `generate-tesla-photos.js`
Script to queue AI image generation jobs via the Gemini worker (future enhancement for custom renders).

## Next Steps (Optional Improvements)

1. **Use actual photos of the specific cars** - Take photos of each vehicle and upload to Supabase Storage
2. **Generate custom AI renders** - Use the `generate-tesla-photos.js` script to create AI-generated images matching each car's exact specs
3. **Update image URLs** - Modify `update-tesla-images.js` to point to the new images and run again

## Technical Notes

- The cars page falls back to SVG silhouettes if `image_url` is null or the image fails to load
- Images are displayed in `car-card__img` with an error handler that shows SVG fallback
- The `svg_key` field determines which SVG silhouette to use (model3 or modelY)
- Current images are from Unsplash under their license terms
