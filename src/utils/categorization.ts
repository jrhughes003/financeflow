// Core category definitions.
//
// Order is behaviour, not presentation: autoCategorize returns the FIRST
// category whose keyword list matches, so anything specific has to sit above
// anything general. 'best buy' lives in electronics and no longer in the
// shopping catch-all, and shopping stays last so it only ever wins when
// nothing else did.
// Custom categories added by the user are stored in context state.

import type { Category } from '../types/domain';
import { lookupMerchant } from './merchants';

export const CATEGORIES: Category[] = [
  {
    id: 'dining_out',
    name: 'Dining Out',
    color: '#f97316',
    icon: 'UtensilsCrossed',
    subcategories: ['Restaurant', 'Fast Food', 'Coffee & Drinks', 'Food Delivery', 'Takeout', 'Bar & Pub'],
    keywords: [
      'uber eats','ubereats','doordash','grubhub','skip','skipthedishes',
      'restaurant','burger','pizza','sushi','cafe','coffee','starbucks','dunkin',
      "mcdonald's",'mcdonalds',"wendy's",'wendys','tim hortons','tims',"tim's",
      'chipotle','subway','panera','deli','bakery','taco','thai','chinese',
      'italian','ramen','pho','bistro','grill','kitchen','eatery','foodhall',
      'harveys',"harvey's",'swiss chalet','a&w','popeyes','five guys','dairy queen',
      'pub','tavern','brewery','lcbo','beer store',
      'lucx','open grill','bp',  // bp can be a convenience store/diner
    ]
  },
  {
    id: 'groceries',
    name: 'Groceries',
    color: '#22c55e',
    icon: 'ShoppingCart',
    subcategories: ['Supermarket', 'Bulk Store', 'Specialty Foods', 'Produce', 'Butcher & Bakery'],
    keywords: [
      'grocery','groceries','supermarket',
      'metro','fortinos','loblaws','nofrills','no frills','food basics','freshco','sobeys',
      'superstore','farm boy','whole foods','trader joe','kroger','safeway',
      'publix','aldi','costco','walmart grocery','instacart',
      'zehrs','longos','independent grocer','iga','maxi','provigo','save-on-foods',
    ]
  },
  {
    id: 'transportation',
    name: 'Transportation',
    color: '#3b82f6',
    icon: 'Car',
    subcategories: ['Gas', 'Parking', 'Ride Share', 'Public Transit', 'Car Maintenance', 'Tolls'],
    keywords: [
      // Gas
      'esso','petro-canada','petro canada','shell','exxon','chevron','sunoco','mobil','gas','fuel',
      'ultramar','husky','pioneer energy','canadian tire gas',
      // Parking
      'parking','honk parking','honk','impark','greenp',
      // Ride share
      'uber ride','lyft',
      // Transit
      'transit','go train','ttc','oc transpo','presto','bus pass','via rail','gotransit',
      // Auto
      'car wash','mechanic','jiffy lube','midas','firestone','autozone','mr lube','407 etr',
    ]
  },
  {
    id: 'housing',
    name: 'Housing',
    color: '#0ea5e9',
    icon: 'Home',
    subcategories: ['Rent', 'Mortgage', 'Property Tax', 'Condo Fees', 'Maintenance & Repairs'],
    keywords: [
      'rent','landlord','mortgage','property tax','condo fee','maintenance fee',
      'strata','realty','property management',
    ]
  },
  {
    id: 'utilities',
    parent: 'housing',
    name: 'Utilities',
    color: '#14b8a6',
    icon: 'Zap',
    subcategories: ['Electricity', 'Heating', 'Water', 'Internet', 'Mobile Phone'],
    keywords: [
      'hydro','hydro one','toronto hydro','bc hydro','enbridge','union gas','fortis',
      'utility','utilities','water bill','waste management',
      'rogers','bell canada','bell mobility','telus','fido','koodo','freedom mobile',
      'virgin plus','public mobile','teksavvy','internet',
    ]
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    color: '#8b5cf6',
    icon: 'RefreshCw',
    subcategories: ['Software', 'Streaming', 'Services', 'Memberships'],
    keywords: [
      'subscription','netflix','hulu','disney','spotify','apple music','amazon prime',
      'hbo','peacock','paramount','youtube premium','twitch','crave',
      'adobe','microsoft','google','dropbox','icloud','github','notion',
      'slack','zoom','linkedin','audible','kindle','setapp','claude','openai',
      'apple.com','uberone','uber one','monthly membership',
    ]
  },
  {
    id: 'health',
    parent: 'products',
    retired: true,
    name: 'Health & Personal Care',
    color: '#ec4899',
    icon: 'HeartPulse',
    subcategories: ['Pharmacy', 'Dental', 'Vision', 'Therapy', 'Fitness', 'Hair & Beauty'],
    keywords: [
      'pharmacy','shoppers drug','pharmasave','rexall','jean coutu','guardian drug',
      'dental','dentist','orthodont','optometr','eye care','physio','chiroprac',
      'massage','therapy','therapist','counselling','medical','clinic','walk-in',
      'gym','fitness','goodlife','planet fitness','crunch','orangetheory','yoga','pilates',
      'salon','barber','spa','sephora','haircut',
    ]
  },
  {
    id: 'entertainment',
    parent: 'products',
    name: 'Entertainment',
    color: '#a855f7',
    icon: 'Ticket',
    subcategories: ['Events & Tickets', 'Cinema', 'Games', 'Books & Music', 'Hobbies'],
    keywords: [
      'ticket','tickets','ticketmaster','eventbrite','stubhub','seatgeek',
      'cineplex','cinema','theatre','theater','imax','landmark cinemas',
      'steam','playstation','xbox','nintendo','epic games','humble bundle',
      'indigo','chapters','coles books','concert','museum','gallery','bowling','arcade',
      'thescore','draftkings',
    ]
  },
  {
    id: 'travel',
    parent: 'transportation',
    name: 'Travel',
    color: '#06b6d4',
    icon: 'Plane',
    subcategories: ['Flights', 'Hotels', 'Car Rental', 'Baggage & Fees', 'Tours'],
    keywords: [
      'air canada','westjet','porter airlines','flair','air transat','united airlines',
      'delta air','american airlines','expedia','booking.com','airbnb','vrbo',
      'hotel','marriott','hilton','holiday inn','best western','hostel',
      'enterprise rent','avis','hertz','budget rent','turo','travel',
    ]
  },
  {
    id: 'insurance',
    parent: 'products',
    retired: true,
    name: 'Insurance',
    color: '#64748b',
    icon: 'ShieldCheck',
    subcategories: ['Auto', 'Home & Tenant', 'Life', 'Health & Dental', 'Travel'],
    keywords: [
      'insurance','intact','aviva','desjardins','belairdirect','td insurance',
      'state farm','allstate','co-operators','sun life','manulife','canada life',
      'wawanesa','economical','square one',
    ]
  },
  {
    id: 'education',
    parent: 'products',
    retired: true,
    name: 'Education',
    color: '#eab308',
    icon: 'GraduationCap',
    subcategories: ['Tuition', 'Books & Supplies', 'Courses', 'Student Loans'],
    keywords: [
      'tuition','university','college','campus','student','osap','textbook',
      'coursera','udemy','pluralsight','masterclass','duolingo','skillshare',
      'school','academy','bookstore',
    ]
  },
  {
    id: 'pets',
    parent: 'products',
    retired: true,
    name: 'Pets',
    color: '#f472b6',
    icon: 'PawPrint',
    subcategories: ['Food & Supplies', 'Veterinary', 'Grooming', 'Boarding'],
    keywords: [
      'petsmart','pet valu','petland','rens pets','pet food',
      'veterinar','vet clinic','animal hospital','grooming','chewy',
    ]
  },
  {
    id: 'gifts_donations',
    parent: 'products',
    name: 'Gifts & Donations',
    color: '#fb7185',
    icon: 'Gift',
    subcategories: ['Gifts', 'Charity', 'Fundraising'],
    keywords: [
      'donation','charity','gofundme','red cross','unicef','united way',
      'food bank','sick kids','heart and stroke','gift card','giftcard',
    ]
  },
  {
    id: 'fees',
    parent: 'products',
    name: 'Fees & Interest',
    color: '#94a3b8',
    icon: 'Receipt',
    subcategories: ['Bank Fees', 'Interest', 'ATM', 'Foreign Exchange', 'Late Fees'],
    keywords: [
      'service charge','monthly fee','account fee','overdraft','nsf','interest charge',
      'atm withdrawal','atm fee','foreign exchange','fx fee','late fee','annual fee',
      'transfer fee','e-transfer fee',
    ]
  },
  {
    id: 'electronics',
    parent: 'products',
    name: 'Electronics',
    color: '#6366f1',
    icon: 'Laptop',
    subcategories: ['Computers', 'Phones & Accessories', 'Audio & Video', 'Components'],
    keywords: [
      'best buy','apple store','canada computers','memory express','newegg',
      'the source','staples','micro center','logitech','anker','samsung store',
    ]
  },
  {
    id: 'clothing',
    parent: 'products',
    name: 'Clothing',
    color: '#d946ef',
    icon: 'Shirt',
    subcategories: ['Everyday', 'Footwear', 'Outerwear', 'Accessories'],
    keywords: [
      'nike','adidas','gap','h&m','zara','uniqlo','nordstrom','tj maxx','marshalls',
      'winners','old navy','lululemon','roots','simons','sport chek',
      'aritzia','urban outfitters','foot locker','shoe company',
    ]
  },
  {
    id: 'home',
    parent: 'housing',
    retired: true,
    name: 'Home & Garden',
    color: '#84cc16',
    icon: 'Sofa',
    subcategories: ['Furniture', 'Hardware & DIY', 'Decor', 'Garden', 'Cleaning Supplies'],
    keywords: [
      'ikea','wayfair','home depot','rona','lowes','home hardware',
      'canadian tire','structube','the brick','bed bath',
      'dollarama','garden centre','nursery','hardware',
    ]
  },
  {
    id: 'products',
    name: 'Shopping',
    color: '#f59e0b',
    icon: 'ShoppingBag',
    subcategories: ['Online Shopping', 'General Merchandise', 'Miscellaneous'],
    keywords: [
      'amazon','walmart','target','ebay','etsy','aliexpress','temu','shein',
      'mill run','scosci',
    ]
  },
];

/**
 * The category anything unrecognised lands in.
 *
 * Looked up by id rather than by position. It used to be
 * `CATEGORIES[CATEGORIES.length - 1]`, which quietly makes the fallback
 * whatever was appended most recently, so adding a category at the end would
 * have silently redirected every unmatched transaction into it.
 */
export const FALLBACK_CATEGORY_ID = 'products';

/**
 * Get all categories: core + any user-created custom categories.
 * Always call this instead of using CATEGORIES directly when you need the full list.
 *
 * Deduplicated by id, with the custom one winning. A user can hold a custom
 * category whose id matches a built-in — the demo ledger does exactly that for
 * `housing`, and anyone who made their own before the taxonomy grew from 5 to
 * 18 could have collided with one of the 13 new ids. Concatenating blindly was
 * survivable while every consumer did a `.find()` by id and took the first
 * match; it stopped being survivable the moment anything iterated the list,
 * which is how Housing came to appear twice in the picker and twice as a
 * budget group.
 *
 * The custom one wins because it is the more deliberate statement: the user
 * named and coloured it, and their stored transactions already point at it.
 */
export function getAllCategories(customCategories: Category[] = []): Category[] {
  const byId = new Map<string, Category>();
  for (const c of CATEGORIES) byId.set(c.id, c);
  for (const c of customCategories || []) if (c?.id) byId.set(c.id, c);
  return [...byId.values()];
}

/**
 * Auto-categorize a transaction based on merchant name keywords.
 * Returns the category id or 'products' (catch-all) if no match found.
 */
export function autoCategorize(merchantName: string, customCategories: Category[] = []): string {
  if (!merchantName) return FALLBACK_CATEGORY_ID;

  // The merchant table first, because it matches on the whole name and so can
  // only be right or silent — it never half-matches the way a substring does.
  // The keyword lists below are the opposite: broad, deliberately fuzzy, and
  // able to catch a merchant nobody has ever listed. Specific before general.
  const known = lookupMerchant(merchantName);
  if (known) return known.category;

  const lower = merchantName.toLowerCase();
  for (const cat of getAllCategories(customCategories)) {
    if ((cat.keywords || []).some(kw => lower.includes(kw))) {
      return cat.id;
    }
  }
  return FALLBACK_CATEGORY_ID;
}

/**
 * The subcategory the merchant table suggests, if it knows this merchant.
 *
 * Separate from autoCategorize because a subcategory is a suggestion for a
 * form field, not a classification: nothing downstream depends on it, and
 * guessing one for an unknown merchant would be noise.
 */
export function autoSubcategory(merchantName: string): string | null {
  return lookupMerchant(merchantName)?.subcategory ?? null;
}

export function getCategoryById(id: string, customCategories: Category[] = []): Category {
  const all = getAllCategories(customCategories);
  return all.find(c => c.id === id)
    || all.find(c => c.id === FALLBACK_CATEGORY_ID)
    || CATEGORIES[CATEGORIES.length - 1];
}
