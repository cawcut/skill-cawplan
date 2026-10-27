### 6. Revise from SQA feedback

**先判会话有没有 `bound_requirement_id`**：

- **已绑定**（create 成功后、或冷交接绑定）→ **不走本节**：不重出五字段、不重跑 steps 3–5b。需求内容的修改走 `workflow-archive.md` 的 **11b-MD**；`summary` / `ticket_id` 的修改走 **11b-PATCH**。
- **未绑定**（新需求、接力入站的未保存草稿）→ 按下文原逻辑。

**未绑定草稿**：When SQA requests changes in natural language (e.g. "约束改成只限会员" or "摘要改成会员专属道具图"), apply **all** requested edits in one pass, then **re-show the complete five fields and the current display summary** — not just "done".

Apply **display-summary regeneration rules** (step 4): if only the summary was edited, keep five fields and update summary; if five fields substantively changed, regenerate summary only when the old summary is no longer accurate.

Re-run steps 3–5 + step 5b tail after each revision round until SQA is satisfied with the **field content** — **do not** enter steps 7+ until save intent is triggered（见 **保存意图闸** below）。

