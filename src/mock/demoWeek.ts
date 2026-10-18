/** Coherent mock data for one household dinner week (Phase 0 prototype). */

export type Recipe = {
  id: string
  title: string
  activeMinutes: number
  totalMinutes: number
  servings: number
  favorite?: boolean
}

export type MealEntry = {
  id: string
  date: string
  dayLabel: string
  shortDay: string
  recipeId: string | null
  status: 'draft' | 'accepted' | 'leftovers' | 'empty'
  busy?: boolean
  note?: string
}

export type GroceryItem = {
  id: string
  name: string
  quantity: string
  aisle: string
  checked: boolean
  source: 'recipe' | 'manual'
  recipeTitle?: string
}

export type PrepTask = {
  id: string
  title: string
  durationMinutes: number
  whenLabel: string
  done: boolean
  linkedRecipeTitle?: string
}

export const householdName = 'Schro kitchen'

export const weekLabel = 'Oct 12 – 18'
export const weekStart = '2026-10-12'

export const recipes: Recipe[] = [
  {
    id: 'r-soup',
    title: 'White bean & kale soup',
    activeMinutes: 20,
    totalMinutes: 45,
    servings: 4,
    favorite: true,
  },
  {
    id: 'r-chicken',
    title: 'Sheet-pan chicken & veg',
    activeMinutes: 15,
    totalMinutes: 40,
    servings: 4,
    favorite: true,
  },
  {
    id: 'r-pasta',
    title: 'Pasta puttanesca',
    activeMinutes: 25,
    totalMinutes: 30,
    servings: 4,
  },
  {
    id: 'r-tacos',
    title: 'Tacos al pastor',
    activeMinutes: 35,
    totalMinutes: 50,
    servings: 4,
  },
  {
    id: 'r-salmon',
    title: 'Salmon rice bowls',
    activeMinutes: 20,
    totalMinutes: 35,
    servings: 3,
    favorite: true,
  },
  {
    id: 'r-pizza',
    title: 'Homemade pizza night',
    activeMinutes: 30,
    totalMinutes: 90,
    servings: 4,
  },
  {
    id: 'r-stirfry',
    title: 'Ginger veggie stir-fry',
    activeMinutes: 25,
    totalMinutes: 30,
    servings: 3,
  },
]

export const recipeById = Object.fromEntries(
  recipes.map((r) => [r.id, r]),
) as Record<string, Recipe>

/** Draft plan: 5 dinners + leftovers night + tonight accepted. */
export const mealPlan: MealEntry[] = [
  {
    id: 'm-mon',
    date: '2026-10-12',
    dayLabel: 'Monday',
    shortDay: 'Mon',
    recipeId: 'r-chicken',
    status: 'accepted',
  },
  {
    id: 'm-tue',
    date: '2026-10-13',
    dayLabel: 'Tuesday',
    shortDay: 'Tue',
    recipeId: 'r-pasta',
    status: 'accepted',
    busy: true,
    note: 'Late practice',
  },
  {
    id: 'm-wed',
    date: '2026-10-14',
    dayLabel: 'Wednesday',
    shortDay: 'Wed',
    recipeId: 'r-tacos',
    status: 'draft',
  },
  {
    id: 'm-thu',
    date: '2026-10-15',
    dayLabel: 'Thursday',
    shortDay: 'Thu',
    recipeId: null,
    status: 'leftovers',
    note: 'Use taco leftovers',
  },
  {
    id: 'm-fri',
    date: '2026-10-16',
    dayLabel: 'Friday',
    shortDay: 'Fri',
    recipeId: 'r-salmon',
    status: 'draft',
  },
  {
    id: 'm-sat',
    date: '2026-10-17',
    dayLabel: 'Saturday',
    shortDay: 'Sat',
    recipeId: 'r-pizza',
    status: 'draft',
  },
  {
    id: 'm-sun',
    date: '2026-10-18',
    dayLabel: 'Sunday',
    shortDay: 'Sun',
    recipeId: 'r-soup',
    status: 'accepted',
    note: 'Tonight',
  },
]

export const tonightMealId = 'm-sun'

export const groceryItems: GroceryItem[] = [
  {
    id: 'g1',
    name: 'Chicken thighs',
    quantity: '2 lb',
    aisle: 'Meat',
    checked: true,
    source: 'recipe',
    recipeTitle: 'Sheet-pan chicken & veg',
  },
  {
    id: 'g2',
    name: 'Salmon fillets',
    quantity: '1 lb',
    aisle: 'Meat',
    checked: false,
    source: 'recipe',
    recipeTitle: 'Salmon rice bowls',
  },
  {
    id: 'g3',
    name: 'Pork shoulder',
    quantity: '1.5 lb',
    aisle: 'Meat',
    checked: false,
    source: 'recipe',
    recipeTitle: 'Tacos al pastor',
  },
  {
    id: 'g4',
    name: 'Kale',
    quantity: '1 bunch',
    aisle: 'Produce',
    checked: false,
    source: 'recipe',
    recipeTitle: 'White bean & kale soup',
  },
  {
    id: 'g5',
    name: 'Yellow onion',
    quantity: '3',
    aisle: 'Produce',
    checked: true,
    source: 'recipe',
    recipeTitle: 'White bean & kale soup',
  },
  {
    id: 'g6',
    name: 'Bell peppers',
    quantity: '2',
    aisle: 'Produce',
    checked: false,
    source: 'recipe',
    recipeTitle: 'Sheet-pan chicken & veg',
  },
  {
    id: 'g7',
    name: 'Pineapple',
    quantity: '1',
    aisle: 'Produce',
    checked: false,
    source: 'recipe',
    recipeTitle: 'Tacos al pastor',
  },
  {
    id: 'g8',
    name: 'Lemon',
    quantity: '2',
    aisle: 'Produce',
    checked: false,
    source: 'manual',
  },
  {
    id: 'g9',
    name: 'Crushed tomatoes',
    quantity: '28 oz',
    aisle: 'Pantry',
    checked: true,
    source: 'recipe',
    recipeTitle: 'Pasta puttanesca',
  },
  {
    id: 'g10',
    name: 'Cannellini beans',
    quantity: '2 cans',
    aisle: 'Pantry',
    checked: false,
    source: 'recipe',
    recipeTitle: 'White bean & kale soup',
  },
  {
    id: 'g11',
    name: 'Spaghetti',
    quantity: '1 lb',
    aisle: 'Pantry',
    checked: true,
    source: 'recipe',
    recipeTitle: 'Pasta puttanesca',
  },
  {
    id: 'g12',
    name: 'Jasmine rice',
    quantity: '1 bag',
    aisle: 'Pantry',
    checked: false,
    source: 'recipe',
    recipeTitle: 'Salmon rice bowls',
  },
  {
    id: 'g13',
    name: 'Pizza dough',
    quantity: '2 balls',
    aisle: 'Bakery',
    checked: false,
    source: 'recipe',
    recipeTitle: 'Homemade pizza night',
  },
  {
    id: 'g14',
    name: 'Corn tortillas',
    quantity: '12',
    aisle: 'Bakery',
    checked: false,
    source: 'recipe',
    recipeTitle: 'Tacos al pastor',
  },
  {
    id: 'g15',
    name: 'Mozzarella',
    quantity: '8 oz',
    aisle: 'Dairy',
    checked: false,
    source: 'recipe',
    recipeTitle: 'Homemade pizza night',
  },
  {
    id: 'g16',
    name: 'Parmesan',
    quantity: '1 wedge',
    aisle: 'Dairy',
    checked: false,
    source: 'manual',
  },
]

export const aisleOrder = ['Produce', 'Meat', 'Dairy', 'Bakery', 'Pantry']

export const prepTasks: PrepTask[] = [
  {
    id: 'p1',
    title: 'Soak / rinse beans; chop onion & kale',
    durationMinutes: 15,
    whenLabel: 'Sunday afternoon',
    done: false,
    linkedRecipeTitle: 'White bean & kale soup',
  },
  {
    id: 'p2',
    title: 'Marinate pork for tacos',
    durationMinutes: 10,
    whenLabel: 'Wednesday morning',
    done: true,
    linkedRecipeTitle: 'Tacos al pastor',
  },
  {
    id: 'p3',
    title: 'Cook rice for salmon bowls',
    durationMinutes: 20,
    whenLabel: 'Friday lunch',
    done: false,
    linkedRecipeTitle: 'Salmon rice bowls',
  },
  {
    id: 'p4',
    title: 'Proof pizza dough',
    durationMinutes: 5,
    whenLabel: 'Saturday morning',
    done: false,
    linkedRecipeTitle: 'Homemade pizza night',
  },
  {
    id: 'p5',
    title: 'Batch roast peppers & onions',
    durationMinutes: 25,
    whenLabel: 'Weekend',
    done: false,
  },
]

export function mealTitle(entry: MealEntry): string {
  if (entry.status === 'leftovers') return entry.note ?? 'Leftovers'
  if (!entry.recipeId) return 'Open night'
  return recipeById[entry.recipeId]?.title ?? 'Untitled meal'
}
