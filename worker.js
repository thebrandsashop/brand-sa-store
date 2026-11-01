export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=utf-8"
    };
    if (request.method === "OPTIONS") return new Response(null, {headers:cors});
    if (url.pathname === "/api/health" && request.method === "GET") {
      return Response.json({ok:true, service:"Brand S/A order API"}, {headers:cors});
    }
    if (url.pathname === "/api/orders" && request.method === "POST") {
      try {
        const body = await request.json();
        const name = clean(body.customer_name, 100);
        const phone = String(body.customer_phone || "").replace(/\D/g, "");
        const address = clean(body.address, 300);
        const city = clean(body.city, 80);
        const state = clean(body.state, 80);
        const pincode = String(body.pincode || "").trim();
        const payment = body.payment_method;
        const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
        if (!name || !/^[6-9]\d{9}$/.test(phone) || !address || !city || !state || !/^[1-9]\d{5}$/.test(pincode)) {
          return Response.json({error:"Please check your delivery details."}, {status:400, headers:cors});
        }
        if (payment !== "COD") return Response.json({error:"Online payment is not enabled yet. Choose COD."}, {status:400, headers:cors});
        if (!items.length) return Response.json({error:"Your cart is empty."}, {status:400, headers:cors});
        let subtotal = 0;
        const safeItems = [];
        for (const item of items) {
          const itemName = clean(item.name, 120);
          const size = clean(item.size || "", 20);
          const price = Number(item.price);
          const quantity = Number(item.quantity);
          if (!itemName || !Number.isInteger(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
            return Response.json({error:"One of the cart items is invalid."}, {status:400, headers:cors});
          }
          // NOTE: Before public launch, replace client-supplied prices with a server-side
          // product lookup. This starter accepts the current hard-coded catalogue prices.
          subtotal += price * quantity;
          safeItems.push({product_name:itemName, size, unit_price:price, quantity, image_url:clean(item.image || "", 500)});
        }
        if (subtotal > 1000000) return Response.json({error:"Order total is too high."}, {status:400, headers:cors});
        const orderCode = "BSA-" + crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
        const headers = {
          "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type":"application/json",
          "Prefer":"return=representation"
        };
        const base = env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";
        const orderResp = await fetch(base + "/orders", {
          method:"POST", headers,
          body:JSON.stringify([{
            order_code:orderCode, customer_name:name, customer_phone:phone,
            address, city, state, pincode, payment_method:"COD",
            subtotal, shipping_fee:0, total:subtotal
          }])
        });
        const orderRows = await orderResp.json();
        if (!orderResp.ok || !Array.isArray(orderRows) || !orderRows[0]) {
          return Response.json({error:"Could not save order. Please try again later."}, {status:502, headers:cors});
        }
        const order = orderRows[0];
        const itemResp = await fetch(base + "/order_items", {
          method:"POST", headers,
          body:JSON.stringify(safeItems.map(i => ({...i, order_id:order.id})))
        });
        if (!itemResp.ok) {
          // Keep order record for admin troubleshooting; tell customer not to retry blindly.
          return Response.json({error:"Order record created but items need store-owner review. Contact the store and share " + orderCode}, {status:502, headers:cors});
        }
        return Response.json({ok:true, order_id:orderCode, total:subtotal}, {status:201, headers:cors});
      } catch (e) {
        return Response.json({error:"Unexpected server error. Please try again later."}, {status:500, headers:cors});
      }
    }
    return Response.json({error:"Not found"}, {status:404, headers:cors});
  }
};
function clean(value, max) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, max);
}
