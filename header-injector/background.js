browser.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    details.requestHeaders.push({ name: "x-refael", value: "7e8afcbdd3" });
    details.requestHeaders.push({ name: "Authorization", value: "Basic " + btoa("admin:D$2sE%$R7aspBq") });
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestHeaders"]
);
