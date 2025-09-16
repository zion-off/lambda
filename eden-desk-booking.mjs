export const handler = async (event) => {
  try {
    const { _eden_session_production, owner_id, desk_number } = JSON.parse(
      event.body
    );

    if (!_eden_session_production || !owner_id || !desk_number) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            "Missing required fields: _eden_session_production, owner_id and desk_number",
        }),
      };
    }

    // Calculate next working day (Sunday-Thursday) in Bangladesh timezone
    const nowInBangladesh = getBangladeshTime();
    const nextWorkingDay = getNextWorkingDay(nowInBangladesh);

    // Format dates for Eden API (Bangladesh timezone +06:00)
    const startDate = formatDateForEden(nextWorkingDay);
    const endDate = formatDateForEden(nextWorkingDay);

    const requestBody = {
      operationName: "CustomerColaReservationsBookDeskMutation",
      variables: {
        input: {
          location_id: "IVVkLRIiGDH4uEN_pyJX6gp-CRDYSYKOPBnfhnVWGQ==",
          owner_id: owner_id,
          title: `Desk ${desk_number}`,
          start_at_parts: {
            date: startDate,
            time: getCurrentTimeString(nowInBangladesh),
          },
          end_at_parts: {
            date: endDate,
            time: "23:59",
          },
        },
      },
      query:
        "mutation CustomerColaReservationsBookDeskMutation($input: ColaReservations_CreateInput!) {\n  cola_reservations_create(input: $input) {\n    message\n    failure\n    returns {\n      reservation {\n        id\n        title\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
    };

    // Make request to Eden API with authentication
    const response = await fetch("https://gapi.eden.io/customer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `_eden_session_production=${_eden_session_production}`,
      },
      body: JSON.stringify(requestBody),
    });

    const responseData = await response.json();

    // Extract new session cookie if present
    let newSessionCookie = _eden_session_production;
    const setCookieHeader = response.headers.get("set-cookie");
    if (
      setCookieHeader &&
      setCookieHeader.includes("_eden_session_production")
    ) {
      const match = setCookieHeader.match(/_eden_session_production=([^;]+)/);
      if (match) {
        newSessionCookie = decodeURIComponent(match[1]);
      }
    }

    return {
      statusCode: response.status,
      body: JSON.stringify({
        success: response.ok,
        data: responseData,
        newSessionCookie: newSessionCookie,
        bookedFor: startDate,
        deskNumber: desk_number,
        ownerId: owner_id,
      }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error",
        message: error.message,
      }),
    };
  }
};

function getBangladeshTime() {
  // Get current time in Bangladesh (UTC+6)
  const now = new Date();
  // Convert to Bangladesh time by adding 6 hours to UTC
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const bangladeshTime = new Date(utc + 6 * 3600000);
  return bangladeshTime;
}

function getNextWorkingDay(currentDate) {
  // currentDate is already in Bangladesh time
  const date = new Date(currentDate);

  // If it's past 5 PM Bangladesh time today, start counting from tomorrow
  if (date.getHours() >= 17) {
    date.setDate(date.getDate() + 1);
  }

  // Get current day of week (0 = Sunday, 1 = Monday, etc.)
  let dayOfWeek = date.getDay();

  // Working days are Sunday (0) through Thursday (4)
  // If it's Friday (5) or Saturday (6), move to next Sunday
  if (dayOfWeek === 5) {
    // Friday
    date.setDate(date.getDate() + 2); // Move to Sunday
  } else if (dayOfWeek === 6) {
    // Saturday
    date.setDate(date.getDate() + 1); // Move to Sunday
  }
  // If it's already a working day (Sun-Thu), use that day

  return date;
}

function formatDateForEden(date) {
  // date is already in Bangladesh time, format as "YYYY-MM-DDTHH:mm:ss+06:00"
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}T00:00:00+06:00`;
}

function getCurrentTimeString(date) {
  // date is already in Bangladesh time, format as "H:mm:ss"
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}
