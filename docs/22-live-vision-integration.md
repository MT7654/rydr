# Live image integration — 3 October 2026

Implemented automatic server-side application-ID lookup using the vision AppKey and cloud API signing using ADP_SecretId / ADP_SecretKey. Each image obtains fresh DescribeStorageCredential authorization (png, IsPublic:true, realtime); no expiring credential needs to be pasted by the operator.

Rydr preserves the original evidence and validates its SHA-256. It sends a metadata-stripped PNG derivative bounded to 2000 pixels, checks the downloaded cloud bytes, then invokes the published ADP image agent. Secrets and signed storage URLs are not written into analysis receipts. Cloud and model failures remain explicit; no sample output replaces them. Existing per-case result caching, retry limits and global AI budget remain active.

The user explicitly authorized metadata-stripped copies of uploaded photos to be sent to Tencent publicly accessible image storage. Uploaded-photo processing is now enabled through RYDR_ADP_PUBLIC_IMAGE_UPLOADS_AUTHORIZED=true. It occurs only on the reviewer Inspect images action; recording a photo alone does not upload it to Tencent. Without this server authorization flag, uploaded-photo processing remains blocked. Originals are read from the originating visitor session and verified before preparing the cloud copy. The UI discloses the public-storage destination.

Verification: 310 automated tests passed before the final restriction; eight focused transport/privacy tests passed after it (including a new no-egress user-photo test). Type checking, lint and production build passed. Three actual native ADP image calls inspected the complete SYN-015 packet and correctly described synthetic illustrations, leaving trip linkage and metadata consistency unknown. See vision-upload-live-report.json. Browser verification is recorded separately below.

Preview: http://127.0.0.1:3013/ . Reviewer -> SYN-015 -> Inspect images. Human approval still governs damage resolutions. This is live pixel inspection of synthetic evidence, not proof that the illustrations establish a damage claim.

Sources: https://www.tencentcloud.com/document/product/1254/70237 ; https://cloud.tencent.com/document/product/1759/116238 ; https://adp.tencent.com/zh/document/218682747739893760

Browser verification: reviewer SYN-015 completed live inspection of three images through the application. Three observation cards persisted after reload. Screenshot: D:/Rydr/tmp/rydr-live-vision-result.png.
Final full regression run: 311 tests passed, 8 opt-in live tests skipped. The dedicated three-image live test passed separately.


Uploaded-photo authorization update: 312 automated tests passed; type checking, lint and production build passed. The uploaded-photo test confirms own-session processing and rejects another session before any cloud request.

Uploaded-photo browser verification completed: recorded an image through the file picker and Record image action in SYN-015, producing v2 with an /api/images/hash reference and unknown capture time. Inspect images completed four live ADP observations, including that uploaded item. All four observations persisted after reload. Screenshot: D:/Rydr/tmp/rydr-uploaded-photo-analysis.png. The test used a synthetic illustration through the upload path; it does not claim testing on real personal photos.
