# Changelog

## [1.1.0](https://github.com/swaaap-nil/Fill-My-Form/compare/v1.0.2...v1.1.0) (2026-09-15)


### Features

* **memory:** stable memory when developemnt ([956d0b6](https://github.com/swaaap-nil/Fill-My-Form/commit/956d0b683a7761c9b0d034cfa06cedb87dc06bef))


### Bug Fixes

* **e2e:** keep the oversized-photo field across grant reload ([23cc581](https://github.com/swaaap-nil/Fill-My-Form/commit/23cc58121e2789e6f3d352542e1c373d3a312924))
* **firefox:** keep the fill panel's active tab in sync ([ffc22f2](https://github.com/swaaap-nil/Fill-My-Form/commit/ffc22f28c0f612a7997bb7dff231fdf689f62d41))

## [1.0.2](https://github.com/swaaap-nil/Fill-My-Form/compare/v1.0.1...v1.0.2) (2026-09-15)


### Bug Fixes

* broken firefox build ([ddf7fe5](https://github.com/swaaap-nil/Fill-My-Form/commit/ddf7fe5da48f0ed74d5b7f954836523b57e805bc))
* **ci:** submit Firefox versions through the AMO API ([a0dfe24](https://github.com/swaaap-nil/Fill-My-Form/commit/a0dfe2444f418663d2525fbaf72cde01c914a9b9))
* firefox bug ([9ef76ec](https://github.com/swaaap-nil/Fill-My-Form/commit/9ef76ecf2eb2fb9f89068df7c18bcdb576859bf0))
* **firefox:** wire toolbar icon to sidebar, fix dev CORS, add regression tests ([a3d7d0a](https://github.com/swaaap-nil/Fill-My-Form/commit/a3d7d0a0c767e4bcf41864f9d8b48e541c8bfd4b))
* remove theme switcher ([1d15ad8](https://github.com/swaaap-nil/Fill-My-Form/commit/1d15ad801791995157f8352bc764a507415726cb))

## [1.0.1](https://github.com/swaaap-nil/Fill-My-Form/compare/v1.0.0...v1.0.1) (2026-09-15)


### Bug Fixes

* **e2e:** scope ibps-like upload assertions per field ([3666c0e](https://github.com/swaaap-nil/Fill-My-Form/commit/3666c0eeeb55cf7fb367030fcbeea71282b62b75))
* **server:** add tests ([e477311](https://github.com/swaaap-nil/Fill-My-Form/commit/e47731121effd58a5f2c003485fc94bf58d1a666))

## 1.0.0 (2026-09-07)


### Features

* add Fill My Form landing page ([12f6ed2](https://github.com/swaaap-nil/Fill-My-Form/commit/12f6ed2600e2ba9045bb67501c645a88194b68b7))
* add local persistence ([2b0dd6c](https://github.com/swaaap-nil/Fill-My-Form/commit/2b0dd6cbde52c39df010b5d4152eb83dc52bf3c5))
* add model tier and scan-gated agent flow ([73ab672](https://github.com/swaaap-nil/Fill-My-Form/commit/73ab672ffa7cb63f1ee9e19fbcdf3ff0575477c7))
* **agent:** add the reducer, the loop, and verification (Phase 2) ([8bd2204](https://github.com/swaaap-nil/Fill-My-Form/commit/8bd220462a9edf195c08725c892c947362bdf360))
* establish AI Form Agent foundation on Extro ([f3019a8](https://github.com/swaaap-nil/Fill-My-Form/commit/f3019a866a60c4c1efe8d18d0887cb6d3a74cd53))
* **fill:** add memory, site-access wiring, and the first real fill ([76b1387](https://github.com/swaaap-nil/Fill-My-Form/commit/76b13878637607e5a81d3acd65ace3ebb60b29ce))
* **form:** add the DOM extractor, FieldId scheme, and extraction goldens ([81f9aac](https://github.com/swaaap-nil/Fill-My-Form/commit/81f9aaca6b518df6a7c525afa6c133dd2254d273))
* implement phase 7 file references ([6eddf55](https://github.com/swaaap-nil/Fill-My-Form/commit/6eddf55fb4dce18136eb8f8bda62da9c97e8c492))
* **matching:** add the deterministic matcher, eval harness, and field journal ([18ef87d](https://github.com/swaaap-nil/Fill-My-Form/commit/18ef87da75a9e911028b02ffde8e1f7107f204b9))
* **memory,ontology:** add value freshness and concept volatility ([a907ffb](https://github.com/swaaap-nil/Fill-My-Form/commit/a907ffb89b4da7ebafb54fe71d781dbd1a643792))
* **ontology:** add confirm-field and alternate-email aliases/concepts ([d758375](https://github.com/swaaap-nil/Fill-My-Form/commit/d758375b4b8ed0f8b573808c1a34a22cefcb0506))
* target firefox mv3 ([c904f4c](https://github.com/swaaap-nil/Fill-My-Form/commit/c904f4c8ba3e72b307c56ed8dd53e32e7b63074f))
* update form extraction and landing install options ([470084f](https://github.com/swaaap-nil/Fill-My-Form/commit/470084f34641098edac8df6c5e4414014e32a9cf))
* update landing branding and extraction support ([c9b894e](https://github.com/swaaap-nil/Fill-My-Form/commit/c9b894e9a55367810b79941698a9d4df7b3a6073))


### Bug Fixes

* blank side panel in dev, and make the icon open it ([a7b6434](https://github.com/swaaap-nil/Fill-My-Form/commit/a7b6434169b8aef82f827bc1db0d1308c2d42edf))
* bun check ran Playwright specs under Bun's test runner ([867e62f](https://github.com/swaaap-nil/Fill-My-Form/commit/867e62fb65cf11eba80c20366ccd0420955576b5))
* explain the dev profile lock instead of failing with a CDP error ([0f10f7c](https://github.com/swaaap-nil/Fill-My-Form/commit/0f10f7c80b8b1737ad064bf3c2d045112d455829))
* **fill:** hide Scan until access is actually granted; resolve the ([8d1dbad](https://github.com/swaaap-nil/Fill-My-Form/commit/8d1dbadb3574bb3e87af9ceda01393d0f76d8ca4))
* run the guard tests that never ran, and clear the lint warning ([730fc6a](https://github.com/swaaap-nil/Fill-My-Form/commit/730fc6a3806d8f22a0312aad4f60359f42d59475))
* side panel opened blank due to frame-ancestors CSP ([c5889b9](https://github.com/swaaap-nil/Fill-My-Form/commit/c5889b9b21d272171f2c78b8042c6d54fbc7cb4d))
