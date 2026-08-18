### 6. Revise from SQA feedback

When SQA requests changes in natural language (e.g. "约束改成只限会员" or "摘要改成会员专属道具图"), apply **all** requested edits in one pass, then **re-show the complete five fields and the current display summary** — not just "done".

Apply **display-summary regeneration rules** (step 4): if only the summary was edited, keep five fields and update summary; if five fields substantively changed, regenerate summary only when the old summary is no longer accurate.

Re-run steps 3–5 + step 5b tail after each revision round until SQA is satisfied with the **field content** — **do not** enter steps 7+ until save intent is triggered（见 **保存意图闸** below）。

