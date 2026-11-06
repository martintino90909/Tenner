// News sources for Tenner. Add or remove a feed by editing this list.
// topic must be one of: tech, biz, cars, world, bio, med
// Check which feeds are working at /api/today?debug=1 after deploying.

export const TOPICS = {
  tech: "Tech & engineering",
  biz: "Business & markets",
  cars: "Cars & motorsport",
  world: "UK & world",
  bio: "Biomedical",
  med: "Medicine & health",
};

// Sites whose article pages Tenner may load for the in-app reader.
export const ARTICLE_SITES = [
  "bbc.co.uk", "bbc.com", "theverge.com", "arstechnica.com", "techcrunch.com",
  "newscientist.com", "theguardian.com", "cnbc.com", "autoexpress.co.uk", "autosport.com",
  "statnews.com", "fiercebiotech.com", "sciencedaily.com", "medicalxpress.com",
];

export const SOURCES = [
  // Tech & engineering
  { name: "BBC Technology", topic: "tech", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { name: "The Verge", topic: "tech", url: "https://www.theverge.com/rss/index.xml" },
  { name: "Ars Technica", topic: "tech", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "TechCrunch", topic: "tech", url: "https://techcrunch.com/feed/" },
  { name: "New Scientist", topic: "tech", url: "https://www.newscientist.com/feed/home/" },

  // Business & markets
  { name: "BBC Business", topic: "biz", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { name: "Guardian Business", topic: "biz", url: "https://www.theguardian.com/uk/business/rss" },
  { name: "CNBC", topic: "biz", url: "https://www.cnbc.com/id/10001147/device/rss/rss.html" },

  // Cars & motorsport
  { name: "Auto Express", topic: "cars", url: "https://www.autoexpress.co.uk/car-news/feed" },
  { name: "Autosport", topic: "cars", url: "https://www.autosport.com/rss/f1/news/" },
  { name: "BBC Sport F1", topic: "cars", url: "https://feeds.bbci.co.uk/sport/formula1/rss.xml" },

  // UK & world
  { name: "BBC UK", topic: "world", url: "https://feeds.bbci.co.uk/news/uk/rss.xml" },
  { name: "BBC World", topic: "world", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Guardian UK", topic: "world", url: "https://www.theguardian.com/uk-news/rss" },
  { name: "Guardian World", topic: "world", url: "https://www.theguardian.com/world/rss" },

  // Biomedical: biotech, life sciences, medical research
  { name: "STAT Biotech", topic: "bio", url: "https://www.statnews.com/category/biotech/feed/" },
  { name: "Fierce Biotech", topic: "bio", url: "https://www.fiercebiotech.com/rss/xml" },
  { name: "ScienceDaily Biotech", topic: "bio", url: "https://www.sciencedaily.com/rss/plants_animals/biotechnology.xml" },
  { name: "ScienceDaily Biology", topic: "bio", url: "https://www.sciencedaily.com/rss/health_medicine/human_biology.xml" },
  { name: "New Scientist Life", topic: "bio", url: "https://www.newscientist.com/subject/life/feed/" },
  { name: "Guardian Medical Research", topic: "bio", url: "https://www.theguardian.com/science/medical-research/rss" },

  // Medicine & health: clinical news, the NHS, public health
  { name: "BBC Health", topic: "med", url: "https://feeds.bbci.co.uk/news/health/rss.xml" },
  { name: "Guardian Health", topic: "med", url: "https://www.theguardian.com/society/health/rss" },
  { name: "Medical Xpress", topic: "med", url: "https://medicalxpress.com/rss-feed/" },
  { name: "STAT Health", topic: "med", url: "https://www.statnews.com/category/health/feed/" },
  { name: "New Scientist Health", topic: "med", url: "https://www.newscientist.com/subject/health/feed/" },
];
