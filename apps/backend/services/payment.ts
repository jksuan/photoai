import Stripe from "stripe";
import { prismaClient } from "db";
import { PlanType } from "@prisma/client";

// Validate environment variables
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error("Missing STRIPE_SECRET_KEY");
}

// Initialize Stripe
const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2025-01-27.acacia",
    })
  : null;

// Define plan prices (单位：分)
export const PLAN_PRICES = {
  basic: 5000, 
  premium: 10000, 
} as const;

// Define credit amounts per plan
export const CREDITS_PER_PLAN = {
  basic: 500,
  premium: 1000,
} as const;

export async function createTransactionRecord(
  userId: string,
  amount: number,
  currency: string,
  paymentId: string,
  orderId: string,
  plan: PlanType,
  status: "PENDING" | "SUCCESS" | "FAILED" = "PENDING"
) {
  try {
    return await withRetry(() =>
      prismaClient.transaction.create({
        data: {
          userId,
          amount,
          currency,
          paymentId,
          orderId,
          plan,
          status,
        },
      })
    );
  } catch (error) {
    console.error("Transaction creation error:", error);
    throw error;
  }
}

export async function createStripeSession(
  userId: string,
  plan: "basic" | "premium",
  email: string
) {
  try {
    if (!stripe) {
      throw new Error("Stripe is not configured");
    }

    const price = PLAN_PRICES[plan];
    console.log("Creating Stripe session...");
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
              description: `One-time payment for ${CREDITS_PER_PLAN[plan]} credits`,
            },
            unit_amount: price,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&token=${Buffer.from(JSON.stringify({timestamp: Date.now(), orderId: '{CHECKOUT_SESSION_ID}'})).toString('base64')}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment/cancel?session_id={CHECKOUT_SESSION_ID}&token=${Buffer.from(JSON.stringify({timestamp: Date.now(), orderId: '{CHECKOUT_SESSION_ID}'})).toString('base64')}`,
      customer_email: email,
      metadata: {
        userId,
        plan,
      },
    });
    console.log("Stripe session created:", session);
    
    // 使用临时的paymentId，后续在webhook中更新
    await createTransactionRecord(
      userId,
      price,
      "usd",
      `pending_${session.id}`,
      session.id,
      plan,
      "PENDING"
    );

    return session;
  } catch (error) {
    console.error("Stripe session creation error:", error);
    throw error;
  }
}

export async function getStripeSession(sessionId: string) {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }
  return await stripe.checkout.sessions.retrieve(sessionId);
}

export async function verifyStripePayment(sessionId: string) {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  // 使用expand参数获取完整的payment_intent信息
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent']
  });
  
  const { userId, plan } = session.metadata as {
    userId: string;
    plan: PlanType;
  };

  // 获取真正的payment_intent ID
  const paymentIntentId = session.payment_intent 
    ? typeof session.payment_intent === 'string' 
      ? session.payment_intent 
      : session.payment_intent.id
    : null;

  // 查找现有的待处理交易
  const existingTransaction = await prismaClient.transaction.findFirst({
    where: {
      orderId: session.id,
      userId: userId,
      status: "PENDING",
    },
  });

  if (!existingTransaction) {
    throw new Error("No pending transaction found for this session");
  }

  // Update the transaction status
  await prismaClient.transaction.update({
    where: {
      id: existingTransaction.id,
    },
    data: {
      status: session.payment_status === "paid" ? "SUCCESS" : "FAILED",
      paymentId: paymentIntentId || existingTransaction.paymentId,
    },
  });

  return session.payment_status === "paid";
}

// Add retry logic for database operations
async function withRetry<T>(
  operation: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      retries > 0 &&
      error instanceof Error &&
      error.message.includes("Can't reach database server")
    ) {
      console.log(`Retrying operation, ${retries} attempts left`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withRetry(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

export async function addCreditsForPlan(userId: string, plan: PlanType) {
  try {
    const credits = CREDITS_PER_PLAN[plan];
    console.log("Adding credits:", { userId, plan, credits });

    return await withRetry(() =>
      prismaClient.userCredit.upsert({
        where: { userId },
        update: { amount: { increment: credits } },
        create: {
          userId,
          amount: credits,
        },
      })
    );
  } catch (error) {
    console.error("Credit addition error:", error);
    throw error;
  }
}

export async function createSubscriptionRecord(
  userId: string,
  plan: PlanType,
  paymentId: string,
  orderId: string,
  isAnnual: boolean = false
) {
  try {
    console.log("Creating subscription:", {
      userId,
      plan,
      paymentId,
      orderId,
      isAnnual,
    });

    return await withRetry(() =>
      prismaClient.$transaction(async (prisma) => {
        // 1. 创建订阅记录
        const subscription = await prisma.subscription.create({
          data: {
            userId,
            plan,
            paymentId,
            orderId,
          },
        });

        // 2. 在同一事务中添加积分
        const credits = CREDITS_PER_PLAN[plan];
        console.log("Adding credits within transaction:", { userId, plan, credits });

        const userCredit = await prisma.userCredit.upsert({
          where: { userId },
          update: { amount: { increment: credits } },
          create: {
            userId,
            amount: credits,
          },
        });

        // 3. 返回包含订阅和积分信息的对象
        return {
          subscription,
          userCredit
        };
      })
    );
  } catch (error) {
    console.error("Subscription creation error:", error);
    throw error;
  }
}

export const PaymentService = {
  createStripeSession,
  getStripeSession,
  createSubscriptionRecord,
  addCreditsForPlan,
};
