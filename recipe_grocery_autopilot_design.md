# Recipe & Grocery Autopilot --- Product Design

**Status:** Draft v1 · **Date:** 18 October 2026\
**Audience:** Product/design/engineering\
**Product principle:** The app should make a good week of dinners easier
than deciding what to order.

## 1. Product vision

A shared household app for two people that turns "What are we eating
this week?" into a low-friction loop:

1.  Suggest a realistic weekly dinner plan.
2.  Let us approve or swap meals quickly.
3.  Generate one accurate, deduplicated grocery list.
4.  Help us shop, prep, and cook with minimal tapping.
5.  Learn from what we actually cook, skip, enjoy, and have on hand.

This is not primarily a recipe-discovery feed or a calorie tracker. It
is a **household dinner autopilot** that keeps both people in sync.

### Success criteria

-   Weekly planning takes **5 minutes or less** after the recipe library
    has a foundation.
-   Grocery list is generated automatically from the plan, with no
    manual ingredient arithmetic.
-   Adding a missing item by voice takes seconds.
-   Either partner can change a meal or check off groceries and see it
    reflected on the other person's device.
-   The plan adapts to busy evenings, leftovers, eating out, and
    ingredients already available.
-   We still use it in week 6---not just during initial setup.

## 2. Research: what exists today

Research reviewed official product pages and help material. Feature
details and pricing can change; validate them before making purchasing
or integration decisions.

  -----------------------------------------------------------------------------------------------------------------------------------------------------------
  Product                                  Strong ideas to learn   Potential gap / design implication
                                           from                    
  ---------------------------------------- ----------------------- ------------------------------------------------------------------------------------------
  [AnyList](https://www.anylist.com/)      Shared, live grocery    Strong household utility baseline. Our opportunity is to automate the *decision-making and
                                           lists; automatic        prep*, not just organize a plan we manually create.
                                           category grouping; Siri [Features](https://www.anylist.com/features) · [Meal
                                           item entry; recipe      planning](https://www.anylist.com/meal-planning)
                                           import; shared recipes  
                                           and meal calendar;      
                                           meal-plan-to-list       
                                           generation. Its         
                                           Complete tier adds meal 
                                           planning and broader    
                                           recipe import.          

  [Paprika](https://www.paprikaapp.com/)   Excellent recipe        Strong recipe-box/cooking model. The product should make weekly planning more proactive
                                           capture, pantry         and make changes to the plan/list/prep flow seamless. [Paprika 4 beta
                                           tracking, aisle-sorted  announcement](https://www.paprikaapp.com/news/2026/09/28/paprika-4-is-now-in-open-beta/)
                                           lists, combining like   
                                           ingredients, serving    
                                           scaling, timers,        
                                           cooking mode, and       
                                           weekly/monthly plans.   
                                           Paprika 4 entered open  
                                           beta in September 2026, 
                                           including family        
                                           sharing and more        
                                           integrations.           

  [Plan to                                 Recipe clipping from    Great plan → list loop, but the user supplies the recipe collection and does the planning.
  Eat](https://www.plantoeat.com/)         web and social sources; Our differentiator is a useful proposed plan based on preferences, schedule, leftovers,
                                           calendar planning;      and pantry. [How it works](https://www.plantoeat.com/)
                                           grocery list            
                                           automatically generated 
                                           from planned meals;     
                                           store/aisle             
                                           organization; reusable  
                                           menus; household        
                                           access.                 

  [Samsung Food](https://samsungfood.com/) Recipe collection and   Useful all-in-one reference. Avoid letting discovery/community content distract from the
                                           discovery;              core household workflow. [Meal planner](https://samsungfood.com/meal-planner/)
                                           drag-and-drop weekly    
                                           planner; meal plan      
                                           converts to a shopping  
                                           list; shared shopping   
                                           and nutrition features. 

  [Mealime](https://www.mealime.com/)      Personalized meal       Strong low-friction onboarding and recipe simplicity. **Important current status:** the
                                           suggestions, fast       official site says Mealime will shut down on 21 October 2026, so it should be studied as a
                                           recipes, auto-generated design reference, not chosen as a new long-term dependency. [Official
                                           categorized grocery     site](https://www.mealime.com/)
                                           list, and a simple plan 
                                           → shop → cook sequence. 

  [Crouton](https://crouton.app/)          Simple weekly planner,  A good reminder that cooking UX should be calm, legible, and usable with messy hands. It
                                           recipe import and       is Apple-platform-focused. [Features](https://crouton.app/)
                                           scanning, household     
                                           sharing, recipe         
                                           scaling, cooking mode,  
                                           timers, and             
                                           auto-generated plans    
                                           from saved recipes.     
  -----------------------------------------------------------------------------------------------------------------------------------------------------------

### Competitive takeaways

The baseline is already well established: recipe saving, calendar
planning, shared grocery lists, combining ingredients, and cooking mode.
Rebuilding only those features would not be enough.

The opportunity is to close the whole loop:

**Household context → proposed plan → one-tap approval → accurate list →
prep plan → cooking → feedback → better next week.**

Do not assume AI is automatically lower-friction. A predictable "approve
these 4 dinners" screen is better than a chatbot that requires a long
prompt every week.

## 3. Primary users and jobs to be done

**Primary household:** two partners sharing dinner planning, groceries,
and cooking.

Jobs: - "Give us a good plan for the week without a 30-minute
discussion." - "Tell me what we need to buy, combining ingredients
across recipes." - "Let me add milk or a missing ingredient from
anywhere, including by voice." - "Tell me what dinner is tonight and how
much work it will take." - "Help us batch-prep a few components so
weeknight cooking is easier." - "If plans change, update the list
without making us rebuild everything."

### Known planning preferences to support

-   Favor high-protein, vegetable-forward meals and flexible
    calorie/nutrition information without making calorie tracking the
    center of the app.
-   Support batch-prepped lunches such as chicken or lean ground turkey
    rice bowls with broccoli, carrots, bell pepper, spicy Asian/Korean
    sauces, and acidic/pickled toppings.
-   Include varied cuisines and familiar favorites; do not make every
    meal a "healthy recipe."
-   Allow quick notes such as "no seafood tonight," "low sodium," "use
    what's in the fridge," or "we have only 20 minutes."

These are configurable household preferences, not hard-coded
assumptions.

## 4. Core product principles

1.  **One source of truth.** The plan, grocery list, recipes, and prep
    tasks must stay linked.
2.  **Default to a proposal, not a blank canvas.** Generate a draft week
    that can be approved or edited.
3.  **Fast edits beat elaborate controls.** Swap, skip, repeat, move, or
    mark leftovers in one or two actions.
4.  **Plan around real life.** Use calendar availability, cooking time,
    leftovers, and eating-out plans.
5.  **Never punish uncertainty.** "Quick dinner," "leftovers," "eating
    out," and "not decided" are valid plan entries.
6.  **Voice is a shortcut, not a separate product.** Voice actions
    should work through Siri/Shortcuts where feasible, with visible
    confirmation.
7.  **Automation must be inspectable.** Show why a meal was suggested
    and what ingredients were added; allow undo.
8.  **Shared by default.** Both partners see the same plan and list,
    with live updates.
9.  **Keep the app useful offline-ish.** Grocery checklist and saved
    recipes should remain usable during poor store/kitchen connectivity.
10. **Earn automation gradually.** Start with explicit rules and
    preferences; introduce AI where it reduces effort reliably.

## 5. MVP scope

### P0 --- must ship

#### A. Shared household

-   Create a household and invite the second partner.
-   Shared recipes, weekly plan, grocery list, pantry basics,
    preferences, and prep tasks.
-   Near-real-time synchronization across phones and desktop.
-   Clear ownership and last-updated state; avoid duplicate list entries
    during concurrent edits.

#### B. Recipe library

-   Save a recipe from a URL using an import/clipper flow.
-   Manual recipe creation and editing.
-   Store title, source URL, ingredients with quantities/units,
    servings, prep/cook time, instructions, tags, and notes.
-   Mark recipes as favorite, tried, or "not for us."
-   Search by title, ingredient, tag, time, and cuisine.
-   Scale servings.
-   Import failure fallback: show the URL and let users paste/edit
    ingredients; never silently pretend extraction succeeded.

#### C. Weekly dinner planner

-   Week view with one card per day.
-   Meal types: planned recipe, leftovers, eating out, quick/freezer
    meal, and undecided.
-   Generate a draft with a configurable number of cooked dinners
    (default: 4--5, not 7).
-   One-tap accept, swap, regenerate one slot, move to another day, or
    mark leftovers.
-   Show total active cooking time and flag overly busy days.
-   Avoid repeating the same main dish too frequently; reuse ingredients
    deliberately.
-   Optional connection to a shared calendar. Initially read busy/free
    times only if permissions allow; do not create calendar events
    without explicit opt-in.

#### D. Grocery list

-   Automatically build from planned recipes for a selected date range.
-   Combine compatible ingredients and quantities (e.g. 1 onion + 2
    onions → 3 onions).
-   Keep incompatible units or ambiguous ingredients separate rather
    than inventing conversions.
-   Group by editable aisle/category; allow store-specific list views
    later.
-   Check off items with immediate sync.
-   Add an item by typing, voice, or a quick-add shortcut.
-   Manual items coexist with recipe-derived items.
-   Show which planned meals need each ingredient.
-   Pantry confirmation: "Already have this?" lets users remove it from
    the shopping list without deleting it from the recipe.
-   When a plan changes, update only the recipe-derived quantities;
    preserve manual items and checked items sensibly.

#### E. Cook mode

-   Clear, large-text instructions with step-by-step navigation.
-   Keep screen awake when supported.
-   Timers launched from instructions.
-   Show ingredient quantities and serving scale in the cooking view.
-   "Start cooking" can mark a recipe as in progress; "Cooked it"
    updates history.
-   Link to the other meal components being cooked at the same time.

#### F. Prep plan

-   Convert the week's recipes into a short, practical prep checklist.
-   Identify shared prep opportunities: chop vegetables once, cook a
    grain batch, mix a sauce, marinate protein, portion lunches.
-   Separate "active work" from passive oven/simmer time.
-   Let users accept, edit, and check off prep tasks.
-   Do not automatically recommend unsafe storage durations; use
    conservative, source-backed food-safety guidance in a later
    iteration.

### P1 --- after the core loop works

-   Smart pantry with quantities, expiry dates, and
    freezer/fridge/cupboard locations.
-   Better calendar-aware planning and reminders.
-   Leftover-aware planning (e.g. cook extra portions Tuesday, schedule
    leftovers Wednesday).
-   Lunch and breakfast planning; batch-prep templates.
-   Nutrition estimates and calorie/protein targets as optional
    metadata.
-   Store preferences and online-cart/export integrations where reliable
    and permitted.
-   Recipe import from photos/screenshots and social platforms.
-   Price/budget estimates.
-   Household-specific ingredient substitutions.
-   Apple Shortcuts/Siri intents for plan lookup, grocery additions, and
    meal-plan generation.
-   Suggested plans based on recent favorites and past ratings.

### Explicitly out of MVP

-   Social network, public recipe feed, comments, followers, creator
    marketplace.
-   Full grocery inventory/barcode system.
-   Automated checkout or retailer accounts.
-   Detailed macro tracking as a required workflow.
-   Complex AI chat as the main interface.
-   Smart-fridge hardware assumptions.
-   Medical or allergy safety guarantees from AI. Allergies should be
    explicit structured constraints and checked deterministically.

## 6. The ideal weekly workflow

### Weekly planning --- 5 minutes or less

1.  App opens to **"Plan next week"** with a draft, not an empty
    calendar.
2.  Draft proposes 4--5 dinners using favorites, recent meals, available
    time, planned events, preferences, and likely leftovers.
3.  Each card shows name, estimated active time, total time, and a
    reason such as "uses the broccoli already on your list."
4.  Both partners can approve or tap **Swap** to see 3 alternatives.
5.  Confirm plan → grocery list is generated and deduplicated
    immediately.
6.  App highlights a small number of pantry checks and prep
    opportunities.
7.  Both partners see the same finalized plan and list.

### Shopping

1.  Open a single shared list, grouped by aisle.
2.  Add items by voice or quick-add without navigating away.
3.  Tap an ingredient to see which recipe(s) require it.
4.  Check off items with large touch targets.
5.  Checked items remain checked during routine plan edits unless the
    underlying item truly changes; show a clear undo.

### Dinner time

1.  Home screen answers **"What's for dinner tonight?"**
2.  One tap opens the recipe in Cook Mode.
3.  If the day becomes busy, tap **Swap for a quick meal**; the grocery
    list recalculates.
4.  After dinner, one light-touch rating: loved it / okay / don't
    suggest again. Optional note or "save as a favorite."
5.  If there are leftovers, record portions and suggest a use-by date
    only when backed by a reliable food-safety rule.

## 7. Automation and intelligence

### Use deterministic rules first

The system should be useful before any LLM is involved. Rules should
handle: - Meal-plan ingredient aggregation. - Unit normalization and
compatible quantity summing. - Calendar-time constraints. - Serving
scaling. - Recipe history and repetition avoidance. - Pantry exclusions
when confidence is high. - Leftover scheduling and prep task generation.

### Use AI where it removes real work

-   Extract recipe data from messy web pages or pasted text, with a
    review step when uncertain.
-   Propose a balanced week from the saved recipe library and household
    preferences.
-   Suggest swaps that fit time, ingredients, and preferences.
-   Turn a natural-language request into a draft change: "We're busy
    Wednesday; move the pasta and make something under 20 minutes."
-   Derive prep steps from recipes and identify shared components.

### Guardrails

-   Never silently change the approved plan.
-   Never silently drop a required ingredient.
-   Show uncertainty for recipe extraction, quantity conversions, and
    substitutions.
-   All AI-generated changes are previews until approved.
-   Allergy exclusions, household rules, and quantity calculations must
    not depend solely on probabilistic AI.
-   Keep a brief explanation and undo path for automated changes.

## 8. UX and information architecture

Use a small, persistent navigation: - **Tonight** --- tonight's meal,
next action, quick swap. - **Plan** --- weekly calendar and draft
generation. - **Groceries** --- shared list, quick-add, aisle
grouping. - **Recipes** --- saved recipes, search, favorites. - **Prep**
--- prep tasks and batch-cooking plan.

On mobile, the most frequent actions should be reachable one-handed. Use
a prominent global quick-add for groceries. Avoid onboarding
questionnaires longer than necessary; gather preferences progressively
after the first useful plan.

### Key screen: Tonight

-   Dinner name, time estimate, and servings.
-   Start cooking.
-   Swap meal.
-   Mark leftovers / eating out.
-   Any prep that should have happened earlier.
-   Optional "add missing ingredient" action.

### Key screen: Plan

-   Weekly view with drag-and-drop on larger screens and simple
    move/swap controls on phones.
-   Generate / regenerate draft.
-   Busy-night indicators.
-   Grocery-list readiness state.
-   Recipe cards include active time, total time, and household rating.

### Key screen: Groceries

-   One combined list, organized by aisle.
-   Large checkbox hit areas.
-   Quick-add always visible.
-   Recipe source shown on item detail.
-   Clear distinction between recipe-linked and manually added items.

## 9. Data model (initial)

Suggested relational entities:

-   `Household(id, name, timezone, created_at)`
-   `HouseholdMember(household_id, user_id, role, preferences_json)`
-   `Recipe(id, household_id, title, source_url, servings, prep_minutes, cook_minutes, instructions, notes, status, created_by)`
-   `RecipeIngredient(id, recipe_id, ingredient_id?, display_name, quantity, unit, preparation, optional, sort_order)`
-   `Ingredient(id, canonical_name, category, aliases_json, default_unit?)`
-   `MealPlan(id, household_id, week_start, status, created_at, approved_at)`
-   `MealPlanEntry(id, meal_plan_id, date, meal_type, recipe_id?, servings, notes, status, sort_order)`
-   `GroceryList(id, household_id, name, date_range_start, date_range_end)`
-   `GroceryItem(id, grocery_list_id, ingredient_id?, display_name, quantity, unit, category, checked_at, source_type, source_recipe_id?, manual, notes)`
-   `PantryItem(id, household_id, ingredient_id?, display_name, quantity?, unit?, location, expires_on?)`
    --- P1
-   `PrepTask(id, meal_plan_id, title, scheduled_for?, duration_minutes?, status, linked_recipe_ids_json, notes)`
-   `CookHistory(id, household_id, recipe_id, cooked_at, rating, feedback)`
-   `HouseholdPreference(id, household_id, key, value_json)`

### Data integrity rules

-   Preserve original ingredient text alongside normalized ingredient
    identity.
-   Store quantities as decimal values and units explicitly; do not
    store "1½ cups" only as a display string.
-   Use household-scoped access controls on every shared record.
-   Use stable IDs and idempotent operations for sync.
-   Track grocery item provenance so plan changes can update derived
    items without deleting manual items.
-   Keep a change history or undo buffer for destructive bulk
    operations.

## 10. Technical direction

Assume a responsive **React + Vite PWA** unless native features prove
necessary. This fits an installable phone-first app and desktop planning
experience.

Suggested initial architecture: - React + TypeScript + Vite. - Tailwind
CSS for a fast, consistent UI system. - PostgreSQL as the source of
truth. - A small typed API layer (REST is sufficient initially). -
Authentication with household membership and invitation flow. -
Server-side authorization and validation. - Realtime updates for shared
grocery-list changes (WebSocket/SSE or a managed realtime service). -
PWA caching for saved recipes and grocery-list usability during
intermittent connectivity. - Background jobs for recipe import, draft
generation, and reminders. - An adapter layer for LLM/recipe extraction
providers so model vendors can be changed without rewriting product
logic.

Do not start with microservices. Keep the domain logic in clear modules:
recipes, meal planning, grocery aggregation, pantry, prep, household
sync, and integrations.

### Sync and offline behavior

-   Grocery check-offs should feel instant; queue changes locally if
    offline and reconcile when connected.
-   Use server timestamps/versioning to resolve conflicts.
-   Prefer merging independent item edits over last-write-wins for the
    entire list.
-   Avoid duplicate grocery items by using normalized ingredient +
    compatible unit + list + provenance rules, while allowing users to
    keep intentionally separate items.

### Privacy and control

-   Household recipes, notes, preferences, and shopping patterns are
    private by default.
-   Do not sell household data or use private recipes to train external
    models without explicit opt-in.
-   Send only the minimum necessary context to AI providers.
-   Allow data export and account/household deletion.
-   Keep credentials and provider keys server-side.
-   Provide clear controls for calendar access, notifications, and AI
    features.

## 11. Recipe and grocery normalization

This is a high-risk correctness area and deserves explicit design.

Examples: - "2 cloves garlic" + "3 cloves garlic" → "5 cloves garlic." -
"1 red bell pepper" + "1 bell pepper" should combine only if ingredient
identity and type are confidently equivalent. - "1 cup chopped spinach"
and "100 g spinach" should not be combined unless a reliable conversion
exists for that ingredient and preparation. - "salt to taste" should not
become a precise purchase quantity. - "olive oil, for the pan" should be
a pantry-check prompt or a non-quantified item, not a fabricated
quantity.

Show an "ingredient needs review" state when parsing is ambiguous. Users
should be able to fix a canonical ingredient once and have the
correction improve future imports.

## 12. Notifications and voice

### Notifications (opt-in, restrained)

-   Weekly planning nudge at a chosen time.
-   Shopping reminder when a list is ready, if requested.
-   Prep reminder only for tasks with meaningful lead time.
-   Dinner reminder based on the household's routine.
-   Never send a notification for every generated change.

### Voice / Siri

Start with the most valuable intents: - "Add eggs to our grocery
list." - "What's for dinner tonight?" - "Mark the milk as bought." (only
if disambiguation is clear) - "Plan four dinners for next week." →
generate a draft for approval. - "We're busy Thursday; suggest a quick
dinner." → suggest or preview a change.

Use Apple Shortcuts/App Intents where feasible. Voice commands that
change the plan should confirm before committing. Do not promise deep
Siri integration until the chosen PWA/native bridge and current OS
capabilities are validated.

## 13. Metrics and validation

Track only what is needed to improve the product: - Time from opening
planner to approving the week. - Percentage of planned dinners actually
cooked, moved, or skipped. - Grocery items added manually versus
generated. - Grocery-list edits caused by incorrect ingredient
aggregation. - Number of meal-plan changes that require grocery-list
repair. - Recipe import success and correction rate. - Weekly active
household usage and retention at weeks 2, 4, and 8. - Number of meals
rated "loved it." - User-reported planning friction.

### Usability tests

Test with both partners on their own phones: 1. Plan five dinners in
under five minutes. 2. Replace one busy-night meal and verify the list
updates correctly. 3. Add an item by voice while doing something else.
4. Check off groceries on one phone and confirm the other updates. 5.
Cook a recipe with wet/dirty hands without losing the step. 6. Recover
gracefully when a recipe URL cannot be imported.

## 14. Recommended build phases

### Phase 0 --- workflow prototype

-   Clickable mobile-first screens for Tonight, Plan, Groceries,
    Recipes, Prep.
-   Test the weekly planning loop before building backend complexity.
-   Decide the minimum household preferences needed for a useful draft.

### Phase 1 --- shared core

-   Authentication and household sharing.
-   Recipe CRUD and URL import.
-   Weekly plan and manual edits.
-   Recipe-derived grocery list, normalization, category grouping, and
    sync.
-   Mobile installability and quick-add.

### Phase 2 --- cook and prep

-   Cook Mode, timers, servings.
-   Prep task generation and shared-component suggestions.
-   Cook history and lightweight ratings.
-   Offline grocery checklist and conflict handling.

### Phase 3 --- autopilot

-   Calendar-aware draft plans.
-   Preference- and history-aware meal suggestions.
-   Pantry-aware planning.
-   Siri/Shortcuts intents.
-   Opt-in reminders and leftover-aware planning.

### Phase 4 --- optimize

-   Online-cart integrations, budget estimates, photo/social recipe
    import, nutrition details, and more advanced pantry management based
    on actual usage.

## 15. Key decisions to make before implementation

1.  **Recipe source:** mostly imported recipes, a built-in curated
    catalog, AI-generated recipes, or a mix? Recommended:
    user-owned/imported recipes first, with optional suggestions.
2.  **Planning cadence:** weekly batch plan only, or allow "decide
    tonight" as a first-class path? Recommended: both.
3.  **Calendar:** connect the existing/new shared calendar in MVP, or
    add it after the manual planner works? Recommended: design for it
    now; make integration opt-in and ship only if it improves
    suggestions without slowing MVP.
4.  **Pantry depth:** simple "already have it" prompts first, full
    inventory later.
5.  **AI provider and hosting:** choose after validating recipe
    extraction accuracy, data-retention terms, cost, and the amount of
    household data that must leave the server.
6.  **Grocery retailer:** start with a reliable generic list; choose
    retailer integrations only after learning where the household shops.

## 16. Definition of done for the MVP

The MVP is ready for real household use when: - Two accounts share the
same recipes, plan, and grocery list. - A user can import or create a
recipe and add it to a day. - The grocery list is generated from the
selected week, combines safe/equivalent ingredients, and preserves
manual items. - Changing or removing a planned meal updates its derived
grocery items without silently deleting unrelated items. - Both partners
can add/check off items with reliable synchronization. - Cook Mode is
usable on a phone. - A weekly draft can be generated from household
preferences and accepted or edited. - Users can export their data and
delete their household. - No AI-generated plan change is committed
without clear user approval.

## Sources

-   AnyList official site and feature comparison:
    https://www.anylist.com/ · https://www.anylist.com/features ·
    https://www.anylist.com/meal-planning
-   AnyList household sharing help:
    https://help.anylist.com/articles/share-recipes-meal-plan/
-   Paprika official site and Paprika 4 beta announcement (28 September
    2026): https://www.paprikaapp.com/ ·
    https://www.paprikaapp.com/news/2026/09/28/paprika-4-is-now-in-open-beta/
-   Plan to Eat official site and pricing/features:
    https://www.plantoeat.com/ · https://www.plantoeat.com/pricing/
-   Plan to Eat recipe import FAQ:
    https://www.plantoeat.com/tour/frequently-asked-questions/
-   Samsung Food official site and planner: https://samsungfood.com/ ·
    https://samsungfood.com/meal-planner/
-   Mealime official site and getting-started guide:
    https://www.mealime.com/ ·
    https://support.mealime.com/article/151-getting-started-guide
-   Crouton official site: https://crouton.app/
