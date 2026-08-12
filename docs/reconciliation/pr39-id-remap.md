# Identifier reconciliation: this branch versus PR #39

PR #39 (`feat(world): the populated world`) merged to `main` while this branch was still in
review, and - like PR #37 before it - independently claimed identifiers this branch already used.
#39 landed first, so THIS branch's identifiers move again. Same method as
[pr37-id-remap.md](./pr37-id-remap.md), including the correction that method earned: a plain
residual scan CANNOT see a miss where source and target ranges overlap, so the check is PER-ID
COUNT INVARIANCE. This table also carries explicit rows for the BARE ADR LINK form
(`[0057](./0057-...`), which has no `ADR-` prefix and is exactly what escaped the #37 remap.

#39 claimed D-204..D-219, PF-253..PF-290 and ADR-0057. Base `c7dd345e` tops out at D-203,
PF-252 and ADR-0056, so on this branch every identifier at or above those is provably ours.

| space | old | new |
| --- | --- | --- |
| DECISION | D-204 | D-220 |
| DECISION | D-205 | D-221 |
| DECISION | D-206 | D-222 |
| DECISION | D-207 | D-223 |
| DECISION | D-208 | D-224 |
| DECISION | D-209 | D-225 |
| DECISION | D-210 | D-226 |
| DECISION | D-211 | D-227 |
| DECISION | D-212 | D-228 |
| DECISION | D-213 | D-229 |
| DECISION | D-214 | D-230 |
| DECISION | D-215 | D-231 |
| DECISION | D-216 | D-232 |
| DECISION | D-217 | D-233 |
| DECISION | D-218 | D-234 |
| DECISION | D-219 | D-235 |
| DECISION | D-220 | D-236 |
| DECISION | D-221 | D-237 |
| DECISION | D-222 | D-238 |
| DECISION | D-223 | D-239 |
| DECISION | D-224 | D-240 |
| DECISION | D-225 | D-241 |
| DECISION | D-226 | D-242 |
| DECISION | D-227 | D-243 |
| DECISION | D-228 | D-244 |
| DECISION | D-229 | D-245 |
| DECISION | D-230 | D-246 |
| DECISION | D-231 | D-247 |
| DECISION | D-232 | D-248 |
| DECISION | D-233 | D-249 |
| DECISION | D-234 | D-250 |
| DECISION | D-235 | D-251 |
| DECISION | D-236 | D-252 |
| DECISION | D-237 | D-253 |
| DECISION | D-238 | D-254 |
| DECISION | D-239 | D-255 |
| DECISION | D-240 | D-256 |
| DECISION | D-241 | D-257 |
| DECISION | D-242 | D-258 |
| DECISION | D-243 | D-259 |
| DECISION | D-244 | D-260 |
| DECISION | D-245 | D-261 |
| DECISION | D-246 | D-262 |
| DECISION | D-247 | D-263 |
| DECISION | D-248 | D-264 |
| DECISION | D-249 | D-265 |
| DECISION | D-250 | D-266 |
| DECISION | D-251 | D-267 |
| DECISION | D-252 | D-268 |
| DECISION | D-253 | D-269 |
| PROOF | PF-253 | PF-291 |
| PROOF | PF-254 | PF-292 |
| PROOF | PF-255 | PF-293 |
| PROOF | PF-256 | PF-294 |
| PROOF | PF-257 | PF-295 |
| PROOF | PF-258 | PF-296 |
| PROOF | PF-259 | PF-297 |
| PROOF | PF-260 | PF-298 |
| PROOF | PF-261 | PF-299 |
| PROOF | PF-262 | PF-300 |
| PROOF | PF-263 | PF-301 |
| PROOF | PF-264 | PF-302 |
| PROOF | PF-265 | PF-303 |
| PROOF | PF-266 | PF-304 |
| PROOF | PF-267 | PF-305 |
| PROOF | PF-268 | PF-306 |
| PROOF | PF-269 | PF-307 |
| PROOF | PF-270 | PF-308 |
| PROOF | PF-271 | PF-309 |
| PROOF | PF-272 | PF-310 |
| PROOF | PF-273 | PF-311 |
| PROOF | PF-274 | PF-312 |
| PROOF | PF-275 | PF-313 |
| PROOF | PF-276 | PF-314 |
| PROOF | PF-277 | PF-315 |
| PROOF | PF-278 | PF-316 |
| PROOF | PF-279 | PF-317 |
| PROOF | PF-280 | PF-318 |
| PROOF | PF-281 | PF-319 |
| PROOF | PF-282 | PF-320 |
| PROOF | PF-283 | PF-321 |
| PROOF | PF-284 | PF-322 |
| PROOF | PF-285 | PF-323 |
| PROOF | PF-286 | PF-324 |
| PROOF | PF-287 | PF-325 |
| PROOF | PF-288 | PF-326 |
| PROOF | PF-289 | PF-327 |
| PROOF | PF-290 | PF-328 |
| PROOF | PF-291 | PF-329 |
| PROOF | PF-292 | PF-330 |
| PROOF | PF-293 | PF-331 |
| PROOF | PF-294 | PF-332 |
| PROOF | PF-295 | PF-333 |
| PROOF | PF-296 | PF-334 |
| PROOF | PF-297 | PF-335 |
| PROOF | PF-298 | PF-336 |
| PROOF | PF-299 | PF-337 |
| PROOF | PF-300 | PF-338 |
| PROOF | PF-301 | PF-339 |
| ADR-LINK | [0058](./0058-line-budget-domain-configuration | [0059](./0059-line-budget-domain-configuration |
| ADR-LINK | [0057](./0057-domain-configuration-schema | [0058](./0058-domain-configuration-schema |
| ADR-LINK | [0057](../adr/0057-domain-configuration-schema | [0058](../adr/0058-domain-configuration-schema |
| ADR-FILE | 0058-line-budget-domain-configuration | 0059-line-budget-domain-configuration |
| ADR-FILE | 0057-domain-configuration-schema | 0058-domain-configuration-schema |
| ADR | ADR-0058 | ADR-0059 |
| ADR | ADR-0057 | ADR-0058 |
