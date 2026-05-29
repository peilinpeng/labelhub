\# LabelHub Codex Rules



Current branch:

\- feature/web-shell



Only modify:

\- apps/web/



Do not modify:

\- packages/contracts/

\- packages/schema-core/

\- packages/schema-renderer/

\- packages/schema-designer/

\- packages/workflow-core/

\- apps/api/

\- packages/db/

\- packages/worker/

\- packages/export/



Do not switch to main.

Do not commit to main.



The web layer must not re-implement:

\- schema traversal

\- visibleWhen

\- validation

\- normalization



Use:

\- SchemaDesigner for Owner

\- SchemaRenderer LABELING for Labeler

\- SchemaRenderer REVIEW\_READONLY / REVIEW\_DIFF for Reviewer



If props are missing, stop and report instead of bypassing component packages.

