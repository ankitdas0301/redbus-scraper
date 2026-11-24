const fs = require('fs');
const { firefox } = require('playwright');

const source = process.env.SOURCE || 'Delhi';
const destination = process.env.DESTINATION || 'Indore';
const travelDate = process.env.TRAVEL_DATE || '2026-11-30';
const acOnly = process.env.AC_ONLY !== 'false';

const CITY_IDS = {
  delhi: 733,
  indore: 313,
  mumbai: 462,
  pune: 130,
  bangalore: 122,
  bengaluru: 122,
  hyderabad: 124,
  jaipur: 807,
  agra: 118
};

function toHHMM(raw) {
  const m = String(raw || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return '00:00';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function calcDurationMinutes(depRaw, arrRaw) {
  const depStr = String(depRaw || '').trim();
  const arrStr = String(arrRaw || '').trim();

  const depIso = depStr.match(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/);
  const arrIso = arrStr.match(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/);
  if (depIso && arrIso) {
    const d1 = new Date(depStr.replace(' ', 'T'));
    const d2 = new Date(arrStr.replace(' ', 'T'));
    const diff = Math.round((d2.getTime() - d1.getTime()) / 60000);
    if (Number.isFinite(diff) && diff > 0) return diff;
  }

  const [dh, dm] = toHHMM(depStr).split(':').map(Number);
  const [ah, am] = toHHMM(arrStr).split(':').map(Number);
  let diff = ah * 60 + am - (dh * 60 + dm);
  if (diff <= 0) diff += 1440;
  return Number.isFinite(diff) ? diff : 0;
}

function detectCoachCategory(busType) {
  const t = String(busType || '');
  const hasSleeper = /sleeper/i.test(t);
  const hasSeater = /seater|semi[\s-]?sleeper/i.test(t);
  if (hasSleeper && hasSeater) return 'seater_sleeper';
  if (hasSeater) return 'seater';
  return 'sleeper';
}

function detectAxleType(busType) {
  return /multi[\s-]?axle/i.test(String(busType || '')) ? 'Multi-Axle' : '';
}

function detectManufacturer(busType) {
  const t = String(busType || '');
  const patterns = [
    /Volvo\s*\d+/i,
    /Volvo/i,
    /Bharat\s*Benz/i,
    /Scania/i,
    /Mercedes[\s-]?Benz/i,
    /Ashok\s*Leyland/i,
    /Eicher/i,
    /Tata/i
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return '';
}

function makeStableKey(operatorName, departureTime, busType) {
  return `${operatorName}_${departureTime}_${busType}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function buildBusDto(raw, sourceUrl) {
  const operatorName = String(raw.operatorName || '').trim();
  const busType = String(raw.busType || 'AC Sleeper').trim();
  const departureTime = toHHMM(raw.departureRaw);
  const arrivalTime = toHHMM(raw.arrivalRaw);
  const durationMinutes = calcDurationMinutes(raw.departureRaw, raw.arrivalRaw);

  const finalFare = Number(raw.finalFare) || 0;
  const originalFare = Number(raw.originalFare) > finalFare ? Number(raw.originalFare) : finalFare;
  const discountAmount = Math.max(0, Math.round((originalFare - finalFare) * 100) / 100);
  const discountPercent =
    originalFare > 0 ? Math.round((discountAmount / originalFare) * 1000) / 10 : 0.0;

  const availableSeats = Math.max(0, Math.round(Number(raw.availableSeats) || 0));
  const rawTotalSeats = Math.round(Number(raw.totalSeats) || 0);
  const totalSeats =
    rawTotalSeats > 0 ? Math.max(rawTotalSeats, availableSeats) : availableSeats > 36 ? 44 : 36;

  const stableBusKey = makeStableKey(operatorName, departureTime, busType);
  const listingId = String(raw.listingId || stableBusKey);

  return {
    listingId,
    stableBusKey,
    operatorName,
    busName: String(raw.busName || busType).trim(),
    busType,
    isAc: Boolean(raw.isAc),
    coachCategory: detectCoachCategory(busType),
    axleType: detectAxleType(busType),
    manufacturerModel: detectManufacturer(busType),
    rating: Math.round((Number(raw.rating) || 0) * 10) / 10,
    reviewCount: Math.max(0, Math.round(Number(raw.reviewCount) || 0)),
    amenities: Array.isArray(raw.amenities) ? raw.amenities.map(String).filter(Boolean) : [],
    sourceUrl,
    departureTime,
    arrivalTime,
    durationMinutes,
    boardingPointsCount: Math.max(0, Math.round(Number(raw.boardingPointsCount) || 0)),
    droppingPointsCount: Math.max(0, Math.round(Number(raw.droppingPointsCount) || 0)),
    boardingSummary: String(raw.boardingSummary || ''),
    droppingSummary: String(raw.droppingSummary || ''),
    distanceKm: Number(raw.distanceKm) || 0.0,
    originalFare,
    currentFare: finalFare,
    discountAmount,
    discountPercent,
    finalFare,
    lowerBerthFare: Number(raw.lowerBerthFare) || 0.0,
    upperBerthFare: Number(raw.upperBerthFare) || 0.0,
    windowSeatFare: Number(raw.windowSeatFare) || 0.0,
    currency: 'INR',
    totalSeats,
    availableSeats,
    lowerBerthsAvailable: Math.max(0, Math.round(Number(raw.lowerBerthsAvailable) || 0)),
    upperBerthsAvailable: Math.max(0, Math.round(Number(raw.upperBerthsAvailable) || 0)),
    windowSeatsAvailable: Math.max(0, Math.round(Number(raw.windowSeatsAvailable) || 0)),
    singleSeatsAvailable: Math.max(0, Math.round(Number(raw.singleSeatsAvailable) || 0)),
    doubleSeatsAvailable: Math.max(0, Math.round(Number(raw.doubleSeatsAvailable) || 0)),
    occupancyConfidence: rawTotalSeats > 0 ? 'High' : 'Medium',
    occupancyMethod: 'GitHub Actions Playwright scraper',
    seatMapSummary: `${availableSeats}/${totalSeats} seats available`
  };
}

function getIstDateString() {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

(async () => {
  const browser = await firefox.launch({ headless: true });

  const d = new Date(`${travelDate}T00:00:00`);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formattedDate = `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;

  const fromId = CITY_IDS[source.toLowerCase()];
  const toId = CITY_IDS[destination.toLowerCase()];
  let searchUrl = `https://www.redbus.in/bus-tickets/${encodeURIComponent(source.toLowerCase())}-to-${encodeURIComponent(destination.toLowerCase())}?onward=${formattedDate}&doj=${formattedDate}`;
  if (fromId && toId) {
    searchUrl += `&fromCityName=${encodeURIComponent(source)}&fromCityId=${fromId}&srcCountry=IND&fromCityType=CITY&toCityName=${encodeURIComponent(destination)}&toCityId=${toId}&destCountry=IND&toCityType=CITY&ref=home`;
  }

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      viewport: { width: 1366, height: 900 },
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata'
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();
    const apiBuses = [];

    page.on('response', async (res) => {
      try {
        const ct = res.headers()['content-type'] || '';
        if (!ct.includes('application/json') || !res.url().includes('redbus')) return;

        const data = await res.json().catch(() => null);
        if (!data) return;

        const list =
          (Array.isArray(data.inventories) && data.inventories) ||
          (Array.isArray(data.inv) && data.inv) ||
          (Array.isArray(data.data?.inventories) && data.data.inventories) ||
          (Array.isArray(data.metaData?.inventories) && data.metaData.inventories) ||
          null;

        if (!list) return;

        for (const item of list) {
          const operatorName = item.travelsName || item.Tvs || item.operatorName || item.ServiceName || '';
          const busType = item.busType || item.bt || item.BusType || '';

          const fares = Array.isArray(item.fareList)
            ? item.fareList
                .map((f) => Number(typeof f === 'object' && f !== null ? f.totalFare ?? f.baseFare ?? f.amount : f))
                .filter((n) => Number.isFinite(n) && n > 0)
            : [];

          const finalFare = Number(
            item.minFare || item.fare || (fares.length ? Math.min(...fares) : 0)
          );

          if (!operatorName || !Number.isFinite(finalFare) || finalFare <= 0) continue;

          const originalFare = Number(
            item.mrp || item.originalFare || item.maxFare || (fares.length ? Math.max(...fares) : finalFare)
          );

          const ratingObj = item.rt && typeof item.rt === 'object' ? item.rt : null;
          const rating = Number(ratingObj ? ratingObj.totRt ?? ratingObj.avg : item.rating ?? item.rt) || 0;
          const reviewCount = Number(ratingObj ? ratingObj.noOfUsers ?? ratingObj.cnt : item.reviewCount ?? item.rc) || 0;

          const bpList = Array.isArray(item.bpData)
            ? item.bpData
            : Array.isArray(item.boardingPoints)
            ? item.boardingPoints
            : [];
          const dpList = Array.isArray(item.dpData)
            ? item.dpData
            : Array.isArray(item.droppingPoints)
            ? item.droppingPoints
            : [];

          apiBuses.push(
            buildBusDto(
              {
                listingId: item.routeId || item.serviceId || item.id || item.inventoryId || '',
                operatorName,
                busName: item.ServiceName || item.serviceName || busType,
                busType,
                isAc:
                  item.isAc === true ||
                  (/\bA\/C\b|\bAC\b/i.test(busType) && !/NON[\s-]?A\/?C/i.test(busType)),
                rating,
                reviewCount,
                amenities: Array.isArray(item.amenities)
                  ? item.amenities.map((a) => (typeof a === 'object' && a !== null ? a.name || a.label || '' : a))
                  : [],
                departureRaw: item.departureTime || item.dt || '',
                arrivalRaw: item.arrivalTime || item.at || '',
                boardingPointsCount: bpList.length || Number(item.bpCount) || 0,
                droppingPointsCount: dpList.length || Number(item.dpCount) || 0,
                boardingSummary: bpList[0]?.Name || bpList[0]?.bpName || '',
                droppingSummary: dpList[0]?.Name || dpList[0]?.dpName || '',
                distanceKm: Number(item.distance || item.distanceKm) || 0,
                originalFare,
                finalFare,
                totalSeats: Number(item.totalSeats || item.maxSeats || item.totSeats || item.ts) || 0,
                availableSeats: Number(item.availableSeats ?? item.avSeats ?? item.AvailableSeats) || 0,
                windowSeatsAvailable: Number(item.windowSeats || item.ws) || 0,
                singleSeatsAvailable: Number(item.singleSeats || item.ss) || 0
              },
              searchUrl
            )
          );
        }
      } catch (_) {}
    });

    console.log('Opening:', searchUrl);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);

    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(800);
    }

    const domBusesRaw = await page.evaluate(() => {
      const cards = document.querySelectorAll('.bus-item, li.row-sec, ul.bus-items > li, [class*="tupleWrapper"], [class*="busCard"]');
      const list = [];
      cards.forEach((card) => {
        const text = card.innerText || '';
        const operatorName =
          card.querySelector('.travels, [class*="travels"]')?.textContent?.trim() ||
          text.split('\n')[0]?.trim() ||
          '';
        const busType =
          card.querySelector('.bus-type, [class*="bus-type"], [class*="busType"]')?.textContent?.trim() || '';
        const departureRaw =
          card.querySelector('.dp-time, [class*="dp-time"], [class*="depTime"]')?.textContent?.trim() || '';
        const arrivalRaw =
          card.querySelector('.bp-time, [class*="bp-time"], [class*="arrTime"]')?.textContent?.trim() || '';
        const fareMatch = (card.querySelector('.fare, .seat-fare, [class*="fare"]')?.textContent || text).match(
          /(?:INR|₹)\s*([\d,]+)/i
        );
        const seatsMatch = (card.querySelector('.seat-left, [class*="seat-left"], [class*="seatsLeft"]')?.textContent || text).match(
          /(\d+)\s*Seats?\s*(?:left|available)/i
        );
        const ratingMatch = text.match(/\b([1-5]\.\d)\b/);

        const finalFare = fareMatch ? parseInt(fareMatch[1].replace(/,/g, ''), 10) : NaN;
        const availableSeats = seatsMatch ? parseInt(seatsMatch[1], 10) : 0;

        if (operatorName && Number.isFinite(finalFare) && finalFare > 50) {
          list.push({
            operatorName,
            busType,
            isAc: /\bA\/C\b|\bAC\b/i.test(busType + ' ' + text) && !/NON[\s-]?A\/?C/i.test(busType + ' ' + text),
            departureRaw,
            arrivalRaw,
            finalFare,
            availableSeats,
            rating: ratingMatch ? parseFloat(ratingMatch[1]) : 0
          });
        }
      });
      return list;
    });

    const domBuses = domBusesRaw.map((b) => buildBusDto(b, searchUrl));
    const combined = apiBuses.length ? apiBuses : domBuses;

    const dedupedMap = new Map();
    for (const bus of combined) {
      if (acOnly && !bus.isAc) continue;
      if (!dedupedMap.has(bus.stableBusKey)) {
        dedupedMap.set(bus.stableBusKey, bus);
      }
    }
    const buses = Array.from(dedupedMap.values());

    const snapshot = {
      status: buses.length > 0 ? 'success_with_buses' : 'success_no_buses',
      scraperVersion: '1.0.0',
      snapshotDate: getIstDateString(),
      collectionTimestampIso: new Date().toISOString(),
      pagesScanned: 1,
      dataQualityScore: buses.length > 0 ? 100.0 : 0.0,
      notes: `GitHub Actions scrape for ${source} -> ${destination} (travel ${travelDate})`,
      buses
    };

    fs.writeFileSync('snapshot.json', JSON.stringify(snapshot, null, 2));
    console.log(`Saved snapshot.json (${snapshot.status}) with ${buses.length} buses.`);
  } catch (err) {
    console.error('EXACT ERROR:', err.message);
    const failedSnapshot = {
      status: 'failed',
      scraperVersion: '1.0.0',
      snapshotDate: getIstDateString(),
      collectionTimestampIso: new Date().toISOString(),
      pagesScanned: 0,
      dataQualityScore: 0.0,
      notes: `Scrape error: ${err.message}`,
      buses: []
    };
    fs.writeFileSync('snapshot.json', JSON.stringify(failedSnapshot, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
      
