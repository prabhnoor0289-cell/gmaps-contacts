/**
 * Google Maps Contact Details Scraper
 *
 * How it works, in plain English:
 *  1. It runs Apify's public Google Maps Scraper to find businesses.
 *  2. It collects every business website from those results.
 *  3. It runs Apify's public Contact Details Scraper on those websites
 *     to pull out emails, phones and social profiles.
 *  4. It merges the two sets of data and saves one row per business.
 *
 * Speed tuning applied:
 *  - Contact scraper crawls multiple sites in parallel (maxConcurrency)
 *  - Fewer pages per site (maxPagesPerWebsite default lowered to 5)
 *  - Blocked sites give up after 1 retry instead of 3
 *  - Both child actors have a hard time limit so one stuck site
 *    can't stall the whole run
 *  - Social-media-only "websites" are skipped before crawling
 */

import { Actor, log } from 'apify';

// The two public actors we build on top of.
const GOOGLE_MAPS_ACTOR = 'compass/crawler-google-places';
const CONTACTS_ACTOR = 'vdrmota/contact-info-scraper';

// Domains that are never worth crawling for contact details.
const SOCIAL_DOMAINS = [
    'facebook.com', 'instagram.com', 'linkedin.com',
    'twitter.com', 'x.com', 'youtube.com', 'tiktok.com',
    'pinterest.com', 'wa.me', 'wechat.com',
];

await Actor.init();

const input = (await Actor.getInput()) ?? {};

const {
    searchStringsArray = [],
    locationQuery = '',
    maxCrawledPlacesPerSearch = 20,
    language = 'en',
    startUrls = [],
    placeIds = [],
    googleMapsDatasetId = '',
    skipPlacesWithoutWebsite = true,
    onlyPlacesWithEmail = false,
    maxPagesPerWebsite = 5,
    maxContactDepth = 1,
    proxyConfiguration = { useApifyProxy: true },
    googleMapsExtraInput = {},
} = input;

const client = Actor.apifyClient;

/** Turn any URL into a bare domain like "example.com" so we can match rows. */
const toDomain = (rawUrl) => {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
        const withScheme = rawUrl.startsWith('http') ? rawUrl : `http://${rawUrl}`;
        return new URL(withScheme).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        return null;
    }
};

const isSocialDomain = (domain) => SOCIAL_DOMAINS.some((social) => domain.includes(social));

/* ------------------------------------------------------------------ *
 * STEP 1 — get the places
 * ------------------------------------------------------------------ */

let places = [];

if (googleMapsDatasetId) {
    // The user already ran Google Maps Scraper themselves and just wants enrichment.
    log.info(`Loading places from existing dataset ${googleMapsDatasetId}`);
    const { items } = await client.dataset(googleMapsDatasetId).listItems();
    places = items;
} else {
    if (!searchStringsArray.length && !startUrls.length && !placeIds.length) {
        throw new Error(
            'Nothing to search for. Fill in "searchStringsArray", or "startUrls", '
            + 'or "placeIds", or "googleMapsDatasetId".',
        );
    }

    const mapsInput = {
        searchStringsArray,
        locationQuery,
        maxCrawledPlacesPerSearch,
        language,
        scrapePlaceDetailPage: true,
        skipClosedPlaces: false,
        // Turn off the expensive extras we do not need for lead generation.
        maxReviews: 0,
        maxImages: 0,
        maxQuestions: 0,
        scrapeContacts: false,
        maximumLeadsEnrichmentRecords: 0,
        ...googleMapsExtraInput, // power users can override anything
    };

    if (startUrls.length) mapsInput.startUrls = startUrls;
    if (placeIds.length) mapsInput.placeIds = placeIds;

    log.info('Starting Google Maps Scraper...', {
        searchStringsArray,
        locationQuery,
        maxCrawledPlacesPerSearch,
    });

    const mapsRun = await Actor.call(GOOGLE_MAPS_ACTOR, mapsInput, {
        memory: 4096,
        timeoutSecs: 600, // 10 minutes max — this stage is normally fast anyway
    });

    if (mapsRun.status !== 'SUCCEEDED') {
        log.warning(`Google Maps Scraper finished with status ${mapsRun.status}. `
            + 'Continuing with whatever results it produced.');
    }

    const { items } = await client.dataset(mapsRun.defaultDatasetId).listItems();
    places = items;
}

log.info(`Got ${places.length} places from Google Maps.`);

if (!places.length) {
    // Always push something, otherwise a paid run silently returns nothing.
    await Actor.pushData({
        '#error': 'No places were found for this input. Try a broader search term or location.',
    });
    await Actor.exit();
}

/* ------------------------------------------------------------------ *
 * STEP 2 — collect the websites worth crawling
 * ------------------------------------------------------------------ */

const domainToPlaces = new Map(); // domain -> [place, place, ...]

for (const place of places) {
    const domain = toDomain(place.website);
    if (!domain) continue;
    if (isSocialDomain(domain)) continue; // skip Facebook/Instagram/etc pages, never worth crawling
    if (!domainToPlaces.has(domain)) domainToPlaces.set(domain, []);
    domainToPlaces.get(domain).push(place);
}

const websiteStartUrls = [...domainToPlaces.keys()].map((domain) => ({ url: `https://${domain}` }));

log.info(`Found ${websiteStartUrls.length} unique websites to scan for contacts.`);

/* ------------------------------------------------------------------ *
 * STEP 3 — scrape contact details from those websites
 * ------------------------------------------------------------------ */

const contactsByDomain = new Map();

if (websiteStartUrls.length) {
    const contactsInput = {
        startUrls: websiteStartUrls,
        maxRequestsPerStartUrl: maxPagesPerWebsite,
        maxDepth: maxContactDepth,
        sameDomain: true,
        mergeContacts: true, // gives us one merged record per website
        considerChildFrames: true,
        maximumLeadsEnrichmentRecords: 0,
        proxyConfig: proxyConfiguration,
        maxRequestRetries: 1,   // don't waste time retrying sites that are actively blocking us
        maxConcurrency: 20,     // crawl many websites in parallel instead of one at a time
        minConcurrency: 5,
    };

    log.info('Starting Contact Details Scraper...');

    const contactsRun = await Actor.call(CONTACTS_ACTOR, contactsInput, {
        memory: 8192,
        timeoutSecs: 600, // 10 minutes max — stop waiting on a handful of stubborn sites
    });

    if (contactsRun.status !== 'SUCCEEDED') {
        log.warning(`Contact Details Scraper finished with status ${contactsRun.status}. `
            + 'Continuing with whatever contact data was collected so far.');
    }

    const { items } = await client.dataset(contactsRun.defaultDatasetId).listItems();
    log.info(`Got ${items.length} contact records.`);

    for (const record of items) {
        const domain = toDomain(record.domain || record.originalStartUrl || record.url);
        if (domain) contactsByDomain.set(domain, record);
    }
}

/* ------------------------------------------------------------------ *
 * STEP 4 — merge and save
 * ------------------------------------------------------------------ */

const pickArray = (value) => (Array.isArray(value) ? value : []);

const results = [];

for (const place of places) {
    const domain = toDomain(place.website);

    if (!domain && skipPlacesWithoutWebsite) continue;

    const contacts = (domain && contactsByDomain.get(domain)) || {};

    const merged = {
        ...place,
        domain: domain || null,
        emails: pickArray(contacts.emails),
        phonesFromWebsite: pickArray(contacts.phones),
        phonesUncertain: pickArray(contacts.phonesUncertain),
        linkedIns: pickArray(contacts.linkedIns),
        twitters: pickArray(contacts.twitters),
        instagrams: pickArray(contacts.instagrams),
        facebooks: pickArray(contacts.facebooks),
        youtubes: pickArray(contacts.youtubes),
        tiktoks: pickArray(contacts.tiktoks),
        pinterests: pickArray(contacts.pinterests),
        discords: pickArray(contacts.discords),
        threads: pickArray(contacts.threads),
        telegrams: pickArray(contacts.telegrams),
        contactPagesScraped: pickArray(contacts.scrapedUrls),
    };

    if (onlyPlacesWithEmail && merged.emails.length === 0) continue;

    results.push(merged);
}

log.info(`Saving ${results.length} rows.`);

// Push in chunks so very large runs do not blow up a single request.
const CHUNK = 500;
for (let i = 0; i < results.length; i += CHUNK) {
    await Actor.pushData(results.slice(i, i + CHUNK));
}

if (!results.length) {
    await Actor.pushData({
        '#error': 'Places were found but none matched your filters (website / email requirements).',
    });
}

// --- Monetization ---------------------------------------------------
// If you later set this Actor to "Pay per event" in Apify Console and
// create an event called "place-with-contacts", uncomment the line below
// to charge for each row you deliver. Leave it commented until then.
//
// await Actor.charge({ eventName: 'place-with-contacts', count: results.length });

await Actor.exit();
