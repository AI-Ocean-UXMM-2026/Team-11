# SupplyLink by OceanPride — A Smart Delivery Recovery Solution

Four-minute English product pitch produced from the running SupplyLink codebase on 23 October 2026.

## Deliverables

- `SupplyLink-by-OceanPride-4min-Pitch.mp4`: 1920 × 1080, 24 fps, H.264, stereo AAC. Narration, burned-in English captions, original synthesized background music, branded opening and closing cards.
- `SupplyLink-by-OceanPride.en.srt`: separate English subtitle file.
- `raw/`: recorded HQ, SME, driver, and branch browser sessions.
- `production/`: scene descriptions, narration and rendering scripts, capture timing, and workflow verification evidence.

## Demonstration

The recorded retailer orders 60 Normal Longyi pieces. HQ reviews labelled sample payment evidence, reserves stock, and dispatches a driver. A simulated vehicle issue puts the order on hold. After resolving the original consignment, the Hlaing branch accepts a 40-piece recovery phase from protected backup stock. HQ supplies the remaining 20 pieces. Each phase records driver handover and retailer receipt. The final order is Done with 60 received, zero remaining, and one wholesale sale for 2,700,000 MMK excluding shipping.

The video includes the longyi catalog, checkout, payment review, driver navigation, retailer tracking, branch acceptance, partial receipt, final completion, stock planning and reports.

## Recording disclosure

- This is actual locally rendered application footage, edited with cuts, holds and enlarged views for readability.
- Orders, payment evidence, stock refills and GPS coordinates are synthetic demonstration records. No real payment, delivery or customer transaction was performed.
- GPS is explicitly labelled as simulated in the edit. Location sharing is foreground-only; drive times are estimates.
- The narration is generated using the English Andrew neural voice. “Supply Link” and “Ocean Pride” are pronunciation spellings; the displayed project name is SupplyLink by OceanPride.
- Stock Planning demo history is synthetic. Optional AI explanations are described without fabricating an explanation or a forecast.
- The closing supplier-pilot invitation is proposed pitch messaging; no customer adoption or measured efficiency gains are claimed.
- All data changes used the isolated local recording database on port 3105. The hosted project was not changed.

## Verification

- Production build and TypeScript checks passed.
- 16 targeted phased-fulfilment tests passed.
- Five local migration and recovery tests passed.
- The recorded order completed both phases. `production/verified-order.json` records 60 received and Done; `production/sales-check.json` records exactly one matching wholesale sale.
- Video layout was reviewed using extracted frames. Final media checks cover duration, video/audio streams, decoding and audio levels.

## Local demo fixes made for recording

The local adapter now includes the existing longyi catalog and price-tier migrations. A report-migration existence check no longer mistakes changed function documentation for a missing migration. Delivery and phase dialogs derive piece/pair labels from their product variants. The temporary video build folder is ignored by Git.

The local production server and browser recorder were created for this video. The separate database folders and footage are retained for review.
