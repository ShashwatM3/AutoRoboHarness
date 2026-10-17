# Deep Research Brief: Free, Public Video of Humans Doing Warehouse, Retail, and Factory Work

## Who this is for and why

This brief is for a deep research agent. The result will become the "ground truth" for a hackathon project built in one day, so the agent should favor data that can be downloaded and used within an hour.

The project is a self-improving "brain" for a fleet of robots being onboarded into a new workspace, such as a warehouse, a factory floor, or a retail store. Robots perform tasks in a simulation and fail in measurable ways. A supervisor agent then compares each failure with video of humans doing the same kind of work, and asks a question such as "what did the human do differently at this moment?" The answer becomes a candidate rule for the robots' shared brain, which is tested before it is kept. For example, a human worker who waits at a blind corner before entering an aisle suggests a rule about slowing at blind corners, and a human who uses two hands for a heavy box suggests a rule about grip for heavy items.

The human video is the evidence behind every rule the system learns, so the project needs footage that clearly shows people performing the same tasks the robots perform. A vision-language model (a model that reads video or images and answers questions about them) will turn each clip into a list of steps and habits, so clips with existing action labels or timestamps are especially valuable.

## The tasks the footage should show

The robots perform four task types, and footage of any of them is useful.
1. **Picking**: taking an item from a shelf, at floor, waist, chest, or overhead height.
2. **Restocking**: placing items onto a shelf or arranging them.
3. **Transporting**: carrying a load or pushing a cart or pallet jack between two points.
4. **Returning**: bringing items back to a shelf or a return area.

The situations around those tasks matter as much as the tasks themselves.
- Navigating narrow aisles, blind corners, doorways, ramps, and crowded areas.
- Giving way to another person, a cart, or a forklift.
- Waiting for or choosing between an elevator, a freight lift, and stairs.
- Handling heavy, fragile, or awkward items, including two-handed lifts and team lifts.
- Safety events such as near misses, slips, trips, collisions, and items falling from shelves.

## What the ideal result looks like

The ideal source meets as many of these requirements as possible. The first three matter most.

1. **Free and downloadable today**, either with no sign-up or with a sign-up that is approved instantly. Sources that require a signed data-use agreement or an approval wait of days should be listed separately.
2. **A license that allows use in a public hackathon project**, ideally a permissive license such as CC BY, CC0, or MIT. Non-commercial licenses such as CC BY-NC are acceptable for this use but must be flagged, and anything with unclear rights must be marked as unclear.
3. **Clear footage of the tasks above**, with the person's hands, body, and surroundings visible.
4. **Fixed overhead or wall-mounted camera views**, similar to CCTV, are preferred, because they match how a supervisor would watch a robot in the simulation. First-person footage from a head-mounted camera is also valuable, because it matches a robot's on-board camera view.
5. **Action labels, timestamps, or captions**, so that the system can find the moment a person picks, places, waits, or gives way without a human watching every clip.
6. **A small, fast subset**, meaning the agent should say whether a useful sample under about 2 GB can be downloaded on its own.
7. **Recent and maintained**, with working download links checked during this research.

## Sources already confirmed

Two NVIDIA datasets on Hugging Face were confirmed on October 17, 2026 and form the baseline that every other source is compared against. Both are synthetic, rendered in NVIDIA Isaac Sim, so the most valuable new finds are real human footage that shows habits these synthetic people cannot.
- `nvidia/PhysicalAI-SmartSpaces`: CC BY 4.0, over 280 hours from nearly 1,800 cameras in warehouses, hospitals and retail spaces, with per-frame 3D positions of humans, forklifts, pallet trucks and mobile robots.
- `nvidia/PhysicalAI-WorldModel-Synthetic-Warehouse-Operations-Scenes` (SDG-Warehouse): OpenMDW 1.1, about 123,000 clips in four scenarios (forklift near-miss with a worker, warehouse fire, forklift hitting a shelf, worker box pickup), from ceiling CCTV and eye-level cameras, in shards of about 5 GB.

The agent should also check whether other NVIDIA, Hugging Face, or LeRobot datasets contain real or synthetic footage of people doing shelf work, since LeRobot is now Hugging Face's standard robotics data format.

## Where to search

The agent should search broadly and confirm every candidate during the research rather than relying on memory. The following candidates are a starting point only, recalled without verification, and each one must be checked for existence, content, license, and access before it is included.
- Retail and shopping video datasets recorded from overhead cameras, such as the MERL Shopping dataset, and any datasets of shoppers or staff interacting with shelves.
- Logistics and packing work datasets, such as OpenPack, and any datasets recorded in real warehouses or distribution centers.
- Industrial and assembly human-activity datasets, such as InHARD, MECCANO, Assembly101, IKEA ASM, and HA-ViD.
- Large egocentric (first-person) video collections with task labels, such as Ego4D and EPIC-KITCHENS, with a clear note on their sign-up requirements and on whether any of their footage shows warehouse or shelf work.
- Surveillance and safety video collections, such as VIRAT, MEVA, and datasets of workplace safety incidents, near misses, or forklift and pedestrian interactions, including collections on Roboflow Universe and Kaggle.
- Free stock-footage libraries with permissive licenses, such as Pexels and Pixabay, searched specifically for warehouse workers, stock clerks, shelf restocking, pallet jacks, carts, stairwells, and freight elevators.
- Research on robots learning from human video, such as work that turns human demonstration videos into robot task plans, followed back to the datasets those papers used.
- Robot-demonstration datasets, such as Open X-Embodiment, DROID, and datasets recorded with the Hello Robot Stretch, as a secondary category in case robot footage of the same tasks is more available than human footage.

## What to return

The agent should return four sections.

**Section 1: a ranked table of sources.** Each row should contain the name, the URL, the license, the access method and wait time, the total size and the size of the smallest useful subset, the camera viewpoint (overhead, wall-mounted, first-person, or mixed), which of the four tasks and which situations it shows, whether action labels or timestamps exist, a link to a sample clip or frame, and a fit score from 1 to 10 against the requirements above with a one-sentence reason.

**Section 2: the top three recommendations**, each with a paragraph explaining exactly which clips or subsets to download, how to download them, and which three to five human habits the footage is likely to show clearly.

**Section 3: a ready-to-use clip list.** For the single best source, the agent should list ten to twenty specific clips or segments, with a direct link or file identifier, the start and end time where possible, the task shown, and the habit the clip demonstrates, such as "worker pauses at the aisle end before crossing" or "worker lifts box with both hands from the bottom shelf."

**Section 4: anything that rules a source out**, such as broken links, approval processes longer than a day, licenses that forbid this use, footage of the wrong tasks, or poor image quality.

## Rules for the research

Every claim about a source should come from the source itself or its official page, checked during this research. When a fact such as the license or the presence of labels cannot be confirmed, the result should say "unconfirmed" rather than guess. The agent should prefer depth on eight to twelve strong sources over shallow coverage of many weak ones, and should state plainly if no source shows a particular task or situation, because that gap changes the project's design.
