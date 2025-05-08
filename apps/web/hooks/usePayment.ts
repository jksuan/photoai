import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { BACKEND_URL } from "@/app/config";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_KEY!);
const apiUrl = BACKEND_URL;

// Create an event bus for credit updates
export const creditUpdateEvent = new EventTarget();

export function usePayment() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { getToken } = useAuth();

  const handlePayment = async (plan: "basic" | "premium", p0: boolean, p1: string) => {
    try {
      setIsLoading(true);
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");

      const response = await fetch(`${apiUrl}/payment/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan, method: p1 }), // 使用传入的支付方法
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Payment failed");

      const stripe = await stripePromise;
      if (!stripe) throw new Error("Stripe initialization failed");

      const { error } = await stripe.redirectToCheckout({
        sessionId: data.sessionId,
      });

      if (error) {
        toast({
          title: "Stripe Error",
          description: error.message,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Payment Error",
        description: "Failed to initialize payment",
        variant: "destructive",
      });
      window.location.href = "/payment/cancel";
    } finally {
      setIsLoading(false);
    }
  };

  return {
    handlePayment,
    isLoading,
  };
}

// Helper function to load Razorpay SDK
// function loadRazorpayScript(): Promise<void> {
//   return new Promise((resolve) => {
//     if (document.getElementById("razorpay-sdk")) {
//       resolve();
//       return;
//     }
//     const script = document.createElement("script");
//     script.id = "razorpay-sdk";
//     script.src = "https://checkout.razorpay.com/v1/checkout.js";
//     script.async = true;
//     script.onload = () => resolve();
//     document.body.appendChild(script);
//   });
// }
