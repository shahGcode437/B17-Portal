import type { Business, FoodProfile } from "@/types/business"
import { deriveFoodCategory } from "@/config/food"

/**
 * Builds a Food & Dining business. `category` is never typed by hand: it is
 * derived from the PRIMARY Food category (`food.categories[0]`), so the
 * display category and the canonical taxonomy have a single source of truth.
 */
function foodBusiness(base: Omit<Business, "vertical" | "category" | "food">, food: FoodProfile): Business {
  return { ...base, vertical: "food", category: deriveFoodCategory(food.categories), food }
}

/**
 * Demo business directory listings (Prototype Data Contract: 6–10, extended
 * with the Food & Dining vertical in FD1). Fictional listings, not real B-17
 * businesses. Menu prices are illustrative demo values — no ratings, reviews,
 * delivery times or contact details are modelled.
 */
export const businesses: Business[] = [
  {
    id: "business-01",
    name: "B-17 Family Pharmacy",
    vertical: "general",
    category: "Pharmacy",
    description: "General pharmacy and healthcare essentials.",
    area: "B-17, Block C (Demo Area)",
    image: "/images/businesses/retail-store.jpg",
    tags: ["pharmacy", "health", "medicine"],
    featured: true,
  },
  {
    id: "business-02",
    name: "Capital Cuts Salon",
    vertical: "general",
    category: "Hairdressing",
    description: "Haircuts, grooming and styling services.",
    area: "B-17, Block A (Demo Area)",
    tags: ["salon", "hairdresser", "grooming"],
  },
  {
    id: "business-03",
    name: "B-17 Tailoring House",
    vertical: "general",
    category: "Tailoring",
    description: "Custom stitching and alterations for men and women.",
    area: "B-17, Block D (Demo Area)",
    tags: ["tailor", "stitching", "alterations"],
  },
  {
    id: "business-04",
    name: "Fresh Mart Grocery",
    vertical: "general",
    category: "Grocery",
    description: "Daily grocery and household essentials.",
    area: "B-17, Block B (Demo Area)",
    image: "/images/businesses/grocery-store.jpg",
    tags: ["grocery", "store", "essentials"],
    featured: true,
  },
  {
    id: "business-05",
    name: "B-17 Auto Care Center",
    vertical: "general",
    category: "Automotive",
    description: "Vehicle servicing, repair and detailing.",
    area: "B-17, Block E (Demo Area)",
    tags: ["automotive", "car service", "repair"],
  },
  // Capital Bakers moved to the Food vertical in FD1 (it was the "Bakery" general business).
  foodBusiness(
    {
      id: "business-06",
      name: "Capital Bakers",
      description: "Fresh bread, cakes and daily bakery items.",
      area: "B-17, Block C (Demo Area)",
      image: "/images/businesses/cafe.jpg",
      tags: ["bakery", "cakes", "bread", "food"],
    },
    {
      categories: ["bakeries", "sweets-desserts"],
      serviceOptions: ["takeaway", "delivery"],
      hoursNote: "Daily, 8 AM–10 PM",
      menuHighlights: [
        { id: "business-06-mh-1", name: "Fresh Milk Bread", section: "Bakery", price: "PKR 250" },
        { id: "business-06-mh-2", name: "Chocolate Fudge Cake", section: "Cakes", description: "Made fresh daily.", price: "PKR 1,800" },
        { id: "business-06-mh-3", name: "Chicken Patties", section: "Savouries", price: "PKR 180" },
      ],
    }
  ),
  {
    id: "business-07",
    name: "B-17 Fitness Studio",
    vertical: "general",
    category: "Fitness",
    description: "Gym, personal training and group fitness classes.",
    area: "B-17, Block A (Demo Area)",
    tags: ["fitness", "gym", "training"],
  },
  foodBusiness(
    {
      id: "business-08",
      name: "Karahi Junction",
      description: "Wok-cooked chicken and mutton karahi with fresh naan, in a family-friendly dining room.",
      area: "B-17, Block A (Demo Area)",
      tags: ["karahi", "naan", "desi", "family dining"],
    },
    {
      categories: ["desi-food", "restaurants"],
      serviceOptions: ["dine-in", "takeaway", "delivery"],
      hoursNote: "Mon–Sun, 12 PM–11 PM",
      menuHighlights: [
        { id: "business-08-mh-1", name: "Chicken Karahi", section: "Mains", description: "Half or full, cooked to order.", price: "PKR 1,400" },
        { id: "business-08-mh-2", name: "Mutton Karahi", section: "Mains", price: "PKR 2,600" },
        { id: "business-08-mh-3", name: "Garlic Naan", section: "Breads", price: "PKR 90" },
        { id: "business-08-mh-4", name: "Mint Raita", section: "Sides" },
      ],
    }
  ),
  foodBusiness(
    {
      id: "business-09",
      name: "Biryani House",
      description: "Slow-cooked chicken, beef and vegetable biryani, served hot all day.",
      area: "B-17, Block C (Demo Area)",
      tags: ["biryani", "pulao", "rice", "desi"],
    },
    {
      categories: ["biryani-rice"],
      serviceOptions: ["dine-in", "takeaway"],
      menuHighlights: [
        { id: "business-09-mh-1", name: "Chicken Biryani", section: "Rice", price: "PKR 450" },
        { id: "business-09-mh-2", name: "Beef Pulao", section: "Rice", price: "PKR 500" },
      ],
    }
  ),
  foodBusiness(
    {
      id: "business-10",
      name: "Smoke & Grill BBQ",
      description: "Charcoal-grilled tikka, seekh kebab and malai boti with chutney and naan.",
      area: "B-17, Block D (Demo Area)",
      tags: ["bbq", "tikka", "kebab", "grill", "charcoal"],
    },
    {
      categories: ["bbq", "restaurants"],
      serviceOptions: ["dine-in", "takeaway"],
      hoursNote: "Mon–Sun, 5 PM–12 AM",
      menuHighlights: [
        { id: "business-10-mh-1", name: "Chicken Tikka", section: "Grill", price: "PKR 650" },
        { id: "business-10-mh-2", name: "Seekh Kebab", section: "Grill", price: "PKR 700" },
        { id: "business-10-mh-3", name: "Malai Boti", section: "Grill", description: "Creamy, mildly spiced chicken pieces." },
      ],
    }
  ),
  foodBusiness(
    {
      id: "business-11",
      name: "Slice & Stack",
      description: "Hand-tossed pizzas, smash burgers and fries for quick takeaway or delivery.",
      area: "B-17, Block B (Demo Area)",
      tags: ["pizza", "burger", "fries", "fast food"],
    },
    {
      categories: ["pizza-burgers", "fast-food"],
      serviceOptions: ["takeaway", "delivery"],
      hoursNote: "Mon–Sun, 1 PM–1 AM",
      menuHighlights: [
        { id: "business-11-mh-1", name: "Fajita Pizza", section: "Pizza", price: "PKR 1,500" },
        { id: "business-11-mh-2", name: "Double Smash Burger", section: "Burgers", price: "PKR 900" },
        { id: "business-11-mh-3", name: "Loaded Fries", section: "Sides" },
      ],
    }
  ),
  foodBusiness(
    {
      id: "business-12",
      name: "Bean Street Cafe",
      description: "Specialty coffee, cold brew and light bites in a quiet seating area.",
      area: "B-17, Block A (Demo Area)",
      image: "/images/businesses/cafe.jpg",
      tags: ["coffee", "cold brew", "sandwiches", "cafe"],
    },
    {
      categories: ["cafes", "tea-snacks"],
      serviceOptions: ["dine-in", "takeaway"],
      hoursNote: "Daily, 9 AM–11 PM",
      menuHighlights: [
        { id: "business-12-mh-1", name: "Flat White", section: "Coffee", price: "PKR 550" },
        { id: "business-12-mh-2", name: "Cold Brew", section: "Coffee", price: "PKR 600" },
        { id: "business-12-mh-3", name: "Club Sandwich", section: "Bites", price: "PKR 750" },
      ],
    }
  ),
  foodBusiness(
    {
      id: "business-13",
      name: "Fresh Squeeze Juice Corner",
      description: "Freshly squeezed seasonal juices and thick milkshakes made to order.",
      area: "B-17, Block E (Demo Area)",
      tags: ["juice", "shake", "smoothie", "fresh fruit"],
    },
    {
      categories: ["juice-shakes"],
      serviceOptions: ["takeaway"],
    }
  ),
  foodBusiness(
    {
      id: "business-14",
      name: "Mithai Mahal",
      description: "Traditional sweets, gulab jamun and festive mithai boxes.",
      area: "B-17, Block D (Demo Area)",
      tags: ["mithai", "sweets", "gulab jamun", "halwa"],
    },
    {
      categories: ["sweets-desserts", "bakeries"],
      serviceOptions: ["takeaway", "delivery"],
      hoursNote: "Daily, 10 AM–10 PM",
    }
  ),
  foodBusiness(
    {
      id: "business-15",
      name: "Chai Point B-17",
      description: "Doodh patti chai, parathas and evening snacks.",
      area: "B-17, Block C (Demo Area)",
      tags: ["chai", "tea", "paratha", "snacks"],
    },
    {
      categories: ["tea-snacks"],
      serviceOptions: ["dine-in", "takeaway"],
      menuHighlights: [
        { id: "business-15-mh-1", name: "Doodh Patti Chai", section: "Tea", price: "PKR 120" },
        { id: "business-15-mh-2", name: "Aloo Paratha", section: "Breakfast", price: "PKR 220" },
        { id: "business-15-mh-3", name: "Samosa Chaat", section: "Snacks" },
      ],
    }
  ),
  foodBusiness(
    {
      id: "business-16",
      name: "Burger Barn",
      description: "Juicy grilled burgers and crispy chicken sandwiches.",
      area: "B-17, Block E (Demo Area)",
      tags: ["burger", "chicken sandwich", "fast food"],
    },
    {
      categories: ["pizza-burgers"],
      serviceOptions: ["dine-in", "takeaway", "delivery"],
      hoursNote: "Mon–Sun, 12 PM–12 AM",
      menuHighlights: [
        { id: "business-16-mh-1", name: "Classic Beef Burger", section: "Burgers", price: "PKR 800" },
        { id: "business-16-mh-2", name: "Zinger Burger", section: "Burgers", price: "PKR 700" },
      ],
    }
  ),
]
