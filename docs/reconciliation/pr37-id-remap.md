# Identifier reconciliation: this branch versus PR #37

PR #37 (`feat(ui): add canonical presentation primitives`) merged to `main` while this branch
was in review, and independently claimed identifiers in three governance id spaces. #37 landed
first, so THIS branch's identifiers move. The mapping below was generated once, asserted TOTAL
and INJECTIVE before any file was touched, and applied mechanically from this table alone -
never by hand and never per-file. A hand-applied remap is how a record ends up citing a real but
WRONG proof, which is valid to every dangling-reference check (the D-229/PF-277 defect class).

The partition is provable: base `d77812ed` tops out at D-190, PF-246 and ADR-0055, so on the
pre-rebase branch EVERY identifier in the ranges below originated here.

| space | old | new |
| --- | --- | --- |
| DECISION | D-191 | D-204 |
| DECISION | D-192 | D-205 |
| DECISION | D-193 | D-206 |
| DECISION | D-194 | D-207 |
| DECISION | D-195 | D-208 |
| DECISION | D-196 | D-209 |
| DECISION | D-197 | D-210 |
| DECISION | D-198 | D-211 |
| DECISION | D-199 | D-212 |
| DECISION | D-200 | D-213 |
| DECISION | D-201 | D-214 |
| DECISION | D-202 | D-215 |
| DECISION | D-203 | D-216 |
| DECISION | D-204 | D-217 |
| DECISION | D-205 | D-218 |
| DECISION | D-206 | D-219 |
| DECISION | D-207 | D-220 |
| DECISION | D-208 | D-221 |
| DECISION | D-209 | D-222 |
| DECISION | D-210 | D-223 |
| DECISION | D-211 | D-224 |
| DECISION | D-212 | D-225 |
| DECISION | D-213 | D-226 |
| DECISION | D-214 | D-227 |
| DECISION | D-215 | D-228 |
| DECISION | D-216 | D-229 |
| DECISION | D-217 | D-230 |
| DECISION | D-218 | D-231 |
| DECISION | D-219 | D-232 |
| DECISION | D-220 | D-233 |
| DECISION | D-221 | D-234 |
| DECISION | D-222 | D-235 |
| DECISION | D-223 | D-236 |
| DECISION | D-224 | D-237 |
| DECISION | D-225 | D-238 |
| DECISION | D-226 | D-239 |
| DECISION | D-227 | D-240 |
| DECISION | D-228 | D-241 |
| DECISION | D-229 | D-242 |
| DECISION | D-230 | D-243 |
| DECISION | D-231 | D-244 |
| DECISION | D-232 | D-245 |
| DECISION | D-233 | D-246 |
| DECISION | D-234 | D-247 |
| DECISION | D-235 | D-248 |
| PROOF | PF-247 | PF-253 |
| PROOF | PF-248 | PF-254 |
| PROOF | PF-249 | PF-255 |
| PROOF | PF-250 | PF-256 |
| PROOF | PF-251 | PF-257 |
| PROOF | PF-252 | PF-258 |
| PROOF | PF-253 | PF-259 |
| PROOF | PF-254 | PF-260 |
| PROOF | PF-255 | PF-261 |
| PROOF | PF-256 | PF-262 |
| PROOF | PF-257 | PF-263 |
| PROOF | PF-258 | PF-264 |
| PROOF | PF-259 | PF-265 |
| PROOF | PF-260 | PF-266 |
| PROOF | PF-261 | PF-267 |
| PROOF | PF-262 | PF-268 |
| PROOF | PF-263 | PF-269 |
| PROOF | PF-264 | PF-270 |
| PROOF | PF-265 | PF-271 |
| PROOF | PF-266 | PF-272 |
| PROOF | PF-267 | PF-273 |
| PROOF | PF-268 | PF-274 |
| PROOF | PF-269 | PF-275 |
| PROOF | PF-270 | PF-276 |
| PROOF | PF-271 | PF-277 |
| PROOF | PF-272 | PF-278 |
| PROOF | PF-273 | PF-279 |
| PROOF | PF-274 | PF-280 |
| PROOF | PF-275 | PF-281 |
| PROOF | PF-276 | PF-282 |
| PROOF | PF-277 | PF-283 |
| PROOF | PF-278 | PF-284 |
| PROOF | PF-279 | PF-285 |
| PROOF | PF-280 | PF-286 |
| PROOF | PF-281 | PF-287 |
| PROOF | PF-282 | PF-288 |
| PROOF | PF-283 | PF-289 |
| PROOF | PF-284 | PF-290 |
| PROOF | PF-285 | PF-291 |
| PROOF | PF-286 | PF-292 |
| PROOF | PF-287 | PF-293 |
| PROOF | PF-288 | PF-294 |
| PROOF | PF-289 | PF-295 |
| ADR | ADR-0056 | ADR-0057 |
| ADR | ADR-0057 | ADR-0058 |
| ADR-FILE | 0056-domain-configuration-schema | 0057-domain-configuration-schema |
| ADR-FILE | 0057-line-budget-domain-configuration | 0058-line-budget-domain-configuration |
