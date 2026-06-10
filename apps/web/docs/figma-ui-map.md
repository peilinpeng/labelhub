\# Figma UI Map



These screenshots come from a clickable Figma prototype. They are UI and interaction references for the LabelHub MVP.



\## MVP Flow



1\. Task Publish

Screenshot: apps/web/docs/figma-screens/1\_task\_publish.png

Routes:

\- /owner/tasks

\- /owner/tasks/new

\- /owner/tasks/:taskId



2\. Template Config

Screenshot: apps/web/docs/figma-screens/2\_template\_config.png

Route:

\- /owner/tasks/:taskId/designer

Implementation:

\- Host SchemaDesigner from @labelhub/schema-designer.

\- Do not manually implement schema logic.



3\. Labeler Workbench

Screenshot: apps/web/docs/figma-screens/3\_labeler\_workbench.png

Route:

\- /labeler/workspace/:assignmentId

Implementation:

\- Host SchemaRenderer in LABELING mode.

\- Do not re-implement validation, visibleWhen, traversal, or normalization.



4\. AI Review

Screenshot: apps/web/docs/figma-screens/4\_ai\_review.png

Routes:

\- /reviewer/items

\- /reviewer/items/:submissionId

Implementation:

\- Show AI review result, dimension scores, comments, prompt summary.



5\. Human Review

Screenshot: apps/web/docs/figma-screens/5\_human\_review.png

Route:

\- /reviewer/items/:submissionId

Implementation:

\- Host SchemaRenderer in REVIEW\_READONLY / REVIEW\_DIFF mode.

\- Do not manually implement diff logic.



\## Design Rules



\- Use the screenshots as visual references.

\- Implement only inside apps/web/.

\- Do not modify packages/.

\- Do not modify apps/api/.

\- Prioritize MVP demo flow over pixel-perfect reproduction.

