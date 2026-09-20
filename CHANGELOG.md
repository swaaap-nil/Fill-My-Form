# Changelog

## [1.3.0](https://github.com/swaaap-nil/Fill-My-Form/compare/v1.2.0...v1.3.0) (2026-09-20)


### Features

* add file preparation sound effects ([66cf859](https://github.com/swaaap-nil/Fill-My-Form/commit/66cf8593e2d3f92447b5e2dbfbf46749376901a5))
* add saved document picker to prepare file ([b7e4a05](https://github.com/swaaap-nil/Fill-My-Form/commit/b7e4a05d753270d3ef97376a3335636f510f45df))
* **files:** add core model for units, ratios and crop geometry ([480560c](https://github.com/swaaap-nil/Fill-My-Form/commit/480560ce3863353ae1ff07d23acf778988e9b072))
* **files:** add resilient local upload preparation ([8b6e56f](https://github.com/swaaap-nil/Fill-My-Form/commit/8b6e56ff0be707dd7bfead27cd771c5ee98d5e6d))
* **files:** crop in a real window, with the selection clamped ([55192e1](https://github.com/swaaap-nil/Fill-My-Form/commit/55192e1deed07c981ad9520313dae134e88f7ec1))
* **files:** honour aspect lock, DPI and a downscale fallback ([18dce8c](https://github.com/swaaap-nil/Fill-My-Form/commit/18dce8c8f077560beb0f1b923df81cf6fb0b58b9))
* **files:** improve prepared handoff and crop UX ([5420361](https://github.com/swaaap-nil/Fill-My-Form/commit/5420361a57ede8d39e433d58caafc73b1dd1927a))
* **files:** read and write image DPI headers ([80b3dfc](https://github.com/swaaap-nil/Fill-My-Form/commit/80b3dfcbfac6823a8ff849e69f4e6f0d7a7a303b))
* **files:** rebuild the preparation form around units and formats ([ea16dcc](https://github.com/swaaap-nil/Fill-My-Form/commit/ea16dcce0614536de8bfc346e93e81d017635343))
* improve file preparation editor UX ([19e0ef8](https://github.com/swaaap-nil/Fill-My-Form/commit/19e0ef802772737015053ab68d172b73a9d1e468))
* polish file prepare UX, handoff, and support surfaces ([9f88435](https://github.com/swaaap-nil/Fill-My-Form/commit/9f88435de6881bf7105fdff1f9598c2433d0a78c))
* show relative last scanned time ([d46a399](https://github.com/swaaap-nil/Fill-My-Form/commit/d46a39910868130e52fa0aa9a5813fdec53204c2))
* tooltips ([1e23bc8](https://github.com/swaaap-nil/Fill-My-Form/commit/1e23bc87cc86e94578f21e6ee889213c5ed7459a))


### Bug Fixes

* centralize object url cleanup ([332f104](https://github.com/swaaap-nil/Fill-My-Form/commit/332f104f26753d0528241499815f2bf4c1b5c621))
* clean up local file data on privacy deletes ([4a09876](https://github.com/swaaap-nil/Fill-My-Form/commit/4a09876aa6584704d9168e9b1431d65240cee473))
* failing tests ([515e64a](https://github.com/swaaap-nil/Fill-My-Form/commit/515e64a93877a7ced86828448cc996bc6e18f973))
* harden fill and memory security gates ([71e7665](https://github.com/swaaap-nil/Fill-My-Form/commit/71e7665c2344a2fc177cb37378c2327ced03529d))
* hide empty answers and verify groups ([f89a50f](https://github.com/swaaap-nil/Fill-My-Form/commit/f89a50f8eecd304cf04bfd2139a1a1a7ce36a9f8))
* icon ([a3d247a](https://github.com/swaaap-nil/Fill-My-Form/commit/a3d247aca17421aaf62630538963fb4f1f2f32c1))
* prevent temporary upload leaks ([e24ba65](https://github.com/swaaap-nil/Fill-My-Form/commit/e24ba65dc9597f8ea5e156037e58e5c91993487c))
* rename sidepanel return action to Back to home ([d91f784](https://github.com/swaaap-nil/Fill-My-Form/commit/d91f78406e1c858236597e0d9a246ba74521a39f))
* route panel prepare through editor-derived crop copy ([5b38236](https://github.com/swaaap-nil/Fill-My-Form/commit/5b38236e0ef4f2998f115b8e1132ecc1562d2d11))
* share resolved fill payloads with agent loop ([092bdd4](https://github.com/swaaap-nil/Fill-My-Form/commit/092bdd481b684dc0322fe71ff6a436820e1765db))

## [1.2.0](https://github.com/swaaap-nil/Fill-My-Form/compare/v1.1.1...v1.2.0) (2026-09-17)


### Features

* add file upload prompts to agent run ([67e7a9e](https://github.com/swaaap-nil/Fill-My-Form/commit/67e7a9ea6fa0ef679c92147993f3a81e8413cb7e))
* add fill feedback animations ([08b787e](https://github.com/swaaap-nil/Fill-My-Form/commit/08b787e5b04f50ad7a6061f47765c0951f4bf4d2))
* add passport country and Twitter profile aliases ([573a4ba](https://github.com/swaaap-nil/Fill-My-Form/commit/573a4ba8e2a6ba022ec81d0bf84c64fff1b5ebfb))
* add semantic UI sound effects ([68358bb](https://github.com/swaaap-nil/Fill-My-Form/commit/68358bbb49f4e6e6a43a8eca6b1d410d780786c7))
* collapse known field proposals ([0f35f22](https://github.com/swaaap-nil/Fill-My-Form/commit/0f35f22e72735a4227cdbcbbd02e9fb212294bdc))
* fold site access into scan action ([e9e07eb](https://github.com/swaaap-nil/Fill-My-Form/commit/e9e07ebb27a354525ba84e5d0ecf78e0a533ac25))
* improve side panel fill workflow UX ([0bc77de](https://github.com/swaaap-nil/Fill-My-Form/commit/0bc77de9581d6fed55fc5250723535521a0267db))
* make summary cards feel clickable ([0d8f19a](https://github.com/swaaap-nil/Fill-My-Form/commit/0d8f19af8daa47855df0d2cc4ba902cc194781e9))


### Bug Fixes

* restore unpacked permission prompt ([ac59d15](https://github.com/swaaap-nil/Fill-My-Form/commit/ac59d150bdbd7da962a604adee8e5c9e30332f3a))

## [1.1.1](https://github.com/swaaap-nil/Fill-My-Form/compare/v1.1.0...v1.1.1) (2026-09-15)


### Bug Fixes

* **ci:** skip redundant CI re-run in release workflow ([3aa61c1](https://github.com/swaaap-nil/Fill-My-Form/commit/3aa61c1088eb9f38f75981c0b822acf64aa551c2))

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
