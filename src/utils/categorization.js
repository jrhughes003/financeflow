// Core category definitions — 5 user-defined categories
// Custom categories added by the user are stored in context state.

export const CATEGORIES = [
  {
    id: 'dining_out',
    name: 'Dining Out',
    color: '#f97316',
    icon: 'UtensilsCrossed',
    subcategories: ['Restaurant', 'Fast Food', 'Coffee & Drinks', 'Food Delivery', 'Takeout'],
    keywords: [
      'uber eats','ubereats','doordash','grubhub','skip','skipthedishes',
      'restaurant','burger','pizza','sushi','cafe','coffee','starbucks','dunkin',
      "mcdonald's",'mcdonalds',"wendy's",'wendys','tim hortons','tims',"tim's",
      'chipotle','subway','panera','deli','bakery','taco','thai','chinese',
      'italian','ramen','pho','bistro','grill','kitchen','eatery','foodhall',
      'lucx','open grill','bp',  // bp can be a convenience store/diner
    ]
  },
  {
    id: 'groceries',
    name: 'Groceries',
    color: '#22c55e',
    icon: 'ShoppingCart',
    subcategories: ['Supermarket', 'Bulk Store', 'Specialty Foods', 'Produce'],
    keywords: [
      'grocery','groceries','supermarket',
      'metro','fortinos','loblaws','nofrills','food basics','freshco','sobeys',
      'superstore','farm boy','whole foods','trader joe','kroger','safeway',
      'publix','aldi','costco','walmart grocery','instacart',
    ]
  },
  {
    id: 'transportation',
    name: 'Transportation',
    color: '#3b82f6',
    icon: 'Car',
    subcategories: ['Gas', 'Parking', 'Ride Share', 'Public Transit', 'Car Maintenance'],
    keywords: [
      // Gas
      'esso','petro-canada','petro canada','shell','exxon','chevron','sunoco','mobil','gas','fuel',
      // Parking
      'parking','honk parking','honk','impark','greenp',
      // Ride share
      'uber ride','lyft',
      // Transit
      'transit','go train','ttc','oc transpo','presto','bus pass',
      // Auto
      'car wash','mechanic','jiffy lube','midas','firestone','autozone',
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
      'hbo','peacock','paramount','youtube premium','twitch',
      'adobe','microsoft','google','dropbox','icloud','github','notion',
      'slack','zoom','linkedin','audible','kindle','setapp',
      'apple.com','uberone','uber one','monthly membership',
    ]
  },
  {
    id: 'products',
    name: 'Products',
    color: '#f59e0b',
    icon: 'ShoppingBag',
    subcategories: ['Online Shopping', 'Electronics', 'Clothing', 'Home Goods', 'Events & Tickets', 'Miscellaneous'],
    keywords: [
      'amazon','walmart','target','best buy','apple store','nike','adidas','gap',
      'h&m','zara','nordstrom','tj maxx','marshalls','ebay','etsy','wayfair','ikea',
      'ticket','tickets','ticketmaster','eventbrite','stubhub',
      'mill run','scosci',
    ]
  },
];

/**
 * Get all categories: core + any user-created custom categories.
 * Always call this instead of using CATEGORIES directly when you need the full list.
 */
export function getAllCategories(customCategories = []) {
  return [...CATEGORIES, ...customCategories];
}

/**
 * Auto-categorize a transaction based on merchant name keywords.
 * Returns the category id or 'products' (catch-all) if no match found.
 */
export function autoCategorize(merchantName, customCategories = []) {
  if (!merchantName) return 'products';
  const lower = merchantName.toLowerCase();
  for (const cat of getAllCategories(customCategories)) {
    if ((cat.keywords || []).some(kw => lower.includes(kw))) {
      return cat.id;
    }
  }
  return 'products';
}

export function getCategoryById(id, customCategories = []) {
  return getAllCategories(customCategories).find(c => c.id === id)
    || CATEGORIES[CATEGORIES.length - 1]; // fallback to Products
}

export function getCategoryColor(id, customCategories = []) {
  return getCategoryById(id, customCategories).color;
}

export function getCategoryName(id, customCategories = []) {
  return getCategoryById(id, customCategories).name;
}
