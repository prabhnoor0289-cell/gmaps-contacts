# Google Maps Contact Details Scraper

Find businesses on Google Maps and get their **email addresses, phone numbers and social media profiles** — not just what Google shows, but what is actually published on each business's own website.

Google Maps almost never shows an email address. This Actor closes that gap: it searches Maps for you, visits every business website it finds, and pulls the contact details off those sites.

## What you get

For every business, one row containing:

| Field | Description |
| --- | --- |
| `title` | Business name |
| `emails` | Email addresses found on the website |
| `phone` / `phonesFromWebsite` | Phone from Google Maps, plus any found on the site |
| `website`, `domain` | Business website |
| `address`, `city`, `postalCode` | Full location |
| `totalScore`, `reviewsCount` | Google rating and review count |
| `linkedIns`, `facebooks`, `instagrams`, `twitters` | Social profiles |
| `url` | Link back to the Google Maps listing |

Export as JSON, CSV, Excel, XML or HTML, or pull it through the API.

## How to use it

1. Enter one or more **search terms** (for example `dentist`, `plumber`, `yoga studio`).
2. Enter a **location** (for example `Chandigarh, India`).
3. Set **max places per search term**.
4. Click **Start**.

Tick **Only keep results that have an email** if you want a clean outreach list with no blanks.

## Example input

```json
{
  "searchStringsArray": ["dentist"],
  "locationQuery": "Chandigarh, India",
  "maxCrawledPlacesPerSearch": 50,
  "language": "en",
  "onlyPlacesWithEmail": true,
  "maxPagesPerWebsite": 10
}
```

## Tips for better results

- **More pages per website = more emails**, but slower and more expensive. 10 is a good balance.
- Emails are usually on `/contact` or `/about` pages, which crawl depth 1 reaches.
- Small local businesses convert best. Large chains hide emails behind contact forms.
- Narrow searches beat broad ones.

## Is this legal?

This Actor only collects information that businesses publish publicly on their own websites. How you use that data is your responsibility — marketing email rules differ by country (GDPR, CAN-SPAM and so on). Check what applies to you before running an outreach campaign.

## Found a bug?

Open an issue on the Issues tab and I will take a look.
