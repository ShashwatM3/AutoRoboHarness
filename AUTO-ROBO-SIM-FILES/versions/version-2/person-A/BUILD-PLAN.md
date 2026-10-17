# Version 2, Person A

Work top to bottom and stop when time runs out.

## A5. Worker views (camera tiles)

- Attach a `PerspectiveCamera` to each robot's head box, looking forward and slightly down.
- Add a switch on the live view between the **3D view** and the **worker views**.
- The worker views show one tile per robot, rendered with `renderer.setViewport` and `renderer.setScissor` into a grid, each with the robot's task and a scrolling list of its steps underneath. Keep it to four tiles.

## A6. Shoppers and more robots

- Load Kenney's **Mini Characters** pack (CC0) for shoppers and move them along seeded paths through the aisles; the engine owns their positions so they appear in the trajectory as distances.
- Allow 3 to 4 robots on the launch screen.
- Add the two other aisles if the layout code makes it cheap.

## A7. History chart

- On the review screen, a line chart of the held-out score for every brain version so far, from `GET /brain/history` (Person B).
