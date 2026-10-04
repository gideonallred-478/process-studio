# Blue appearance verification

October 4, 2026.

- Light, Dark and System modes use an independent browser preference, synchronize across tabs, and survive reloads. System follows OS appearance changes.
- Dark palettes cover studio, library, recording review, editor, automation, settings, results, local setup and the hosted notice. Original artwork has matching light and dark versions.
- Three new theme tests were observed failing before implementation; all 171 source tests now pass. Build, browser imports and worker validation pass.
- 29 isolated compiled-browser checks pass, including desktop/mobile layouts, dark reload persistence, OS appearance changes, manual precedence, image loading and absence of page errors. See theme-browser.json.
- Hosted AI remains logged out and hosted storage remains unconfigured. Actual camera hardware and full fresh-machine installation are outside this appearance verification.

## Production verification

Published to https://vercel-logged-out.vercel.app on October 4, 2026. Deployment dpl_2y7u2L1uhdwnzB4LdXrtYNwY3r8m is Ready. Twenty public HTTP and isolated Edge checks pass: root route without index.html; exact theme assets and clean local archive; signed-out ChatGPT with zero accounts; persistent dark mode; System appearance changes; matching dark artwork and hosted notice; mobile layout; no uncaught page errors. Hosted storage remains unconfigured. See theme-vercel-live.json and theme-vercel-deploy.log.

Previous deployment retained for rollback: dpl_FEt6WP71BXJyDpM8AZZdV2QLtkJq.
