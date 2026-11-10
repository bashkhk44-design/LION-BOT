import os
import json
import random
import hashlib
import secrets
import logging
from pathlib import Path

from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    filters
)

load_dotenv(override=True)

TOKEN = os.environ.get("BOT_TOKEN")
WALLET_ADDRESS = "46d690b623b41d959bd438568e5cd913"

if not TOKEN:
    raise RuntimeError("BOT_TOKEN غير مضبوط في ملف .env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB = Path("players.json")
DEPOSITS = Path("deposit_requests.json")

players = {}


def load():
    global players

    if DB.exists():
        try:
            players = json.loads(DB.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            logger.exception("خطأ في قراءة players.json")
            players = {}
    else:
        players = {}


def save():
    DB.write_text(
        json.dumps(players, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def account(uid):
    uid = str(uid)

    if uid not in players:
        players[uid] = {
            "points": 100,
            "username": None,
            "password": None,
            "wallet": None
        }
        save()

    return players[uid]


def menu():
    buttons = [
        [InlineKeyboardButton("👤 إنشاء حساب", callback_data="register")],
        [InlineKeyboardButton("💳 شحن حساب", callback_data="deposit")],
        [InlineKeyboardButton("💸 سحب من الحساب", callback_data="withdraw")],
        [InlineKeyboardButton("🌐 موقع الألعاب", callback_data="website")],
        [InlineKeyboardButton("💰 رصيدي", callback_data="balance")],
        [InlineKeyboardButton("🎮 الألعاب", callback_data="games")]
    ]

    return InlineKeyboardMarkup(buttons)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    p = account(update.effective_user.id)

    context.user_data.pop("action", None)

    await update.message.reply_text(
        f"🦁 أهلاً بك في LION GAMES\n"
        f"رصيدك التجريبي: {p['points']} نقطة\n"
        "اختر الخدمة:",
        reply_markup=menu()
    )


async def buttons(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()

    uid = str(q.from_user.id)
    p = account(uid)
    choice = q.data

    if choice == "register":
        if p["username"]:
            await q.message.reply_text("لديك حساب مسجل بالفعل.")
        else:
            context.user_data["action"] = "register_username"
            await q.message.reply_text(
                "أرسل اسم المستخدم الذي تريد تسجيله:"
            )

    elif choice == "deposit":
        context.user_data.pop("action", None)

        await q.message.reply_text(
            "💳 اختر طريقة شحن حسابك:",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("💚 شام كاش", callback_data="deposit_sham")],
                [InlineKeyboardButton("📱 سيرياتيل كاش", callback_data="deposit_syriatel")],
                [InlineKeyboardButton("₮ USDT", callback_data="deposit_usdt")],
                [InlineKeyboardButton("⬅️ رجوع", callback_data="menu")]
            ])
        )

    elif choice == "deposit_sham":
        context.user_data["payment_method"] = "شام كاش"
        context.user_data["action"] = "deposit_amount"

        await q.message.reply_text(
            f"💚 شام كاش\n"
            f"عنوان الاستقبال:\n{WALLET_ADDRESS}\n\n"
            "أرسل مبلغ الشحن:"
        )

    elif choice == "deposit_syriatel":
        context.user_data["payment_method"] = "سيرياتيل كاش"
        context.user_data["action"] = "deposit_amount"

        await q.message.reply_text(
            "📱 سيرياتيل كاش\n"
            "رقم التحويل: 85370602\n\n"
            "أرسل مبلغ الشحن:"
        )

    elif choice == "deposit_usdt":
        context.user_data["payment_method"] = "USDT"
        context.user_data["action"] = "deposit_amount"

        await q.message.reply_text(
            "₮ الدفع عبر USDT\n"
            "الشبكة: BEP20 (BNB Smart Chain)\n"
            "عنوان الاستقبال:\n"
            "0x172ae5bCaEcbFe258b70b41EC372bB2f8E04C761\n\n"
            "أرسل مبلغ الشحن:"
        )

    elif choice == "withdraw":
        context.user_data["action"] = "withdraw"

        await q.message.reply_text(
            "💸 أرسل مقدار الرصيد التجريبي الذي تريد سحبه:"
        )

    elif choice == "website":
        await q.message.reply_text(
            "🌐 رابط موقع الألعاب:\nhttps://eaglebet99.com/"
        )

    elif choice == "balance":
        await q.message.reply_text(
            f"💰 رصيدك الحالي: {p['points']} نقطة تجريبية"
        )

    elif choice == "games":
        context.user_data.pop("action", None)

        await q.message.reply_text(
            "🎮 اختر لعبة:",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🎰 Slots", callback_data="slots")],
                [InlineKeyboardButton("🎡 Roulette", callback_data="roulette")],
                [InlineKeyboardButton("💣 Mines", callback_data="mines")],
                [InlineKeyboardButton("🚀 Crash", callback_data="crash")],
                [InlineKeyboardButton("⬅️ القائمة", callback_data="menu")]
            ])
        )

    elif choice == "menu":
        context.user_data.pop("action", None)

        await q.message.reply_text(
            "القائمة الرئيسية:",
            reply_markup=menu()
        )

    elif choice == "slots":
        symbols = ["🍒", "🍋", "🍇", "⭐", "7️⃣"]
        result = [random.choice(symbols) for _ in range(3)]

        prize = (
            100 if result[0] == result[1] == result[2]
            else 20 if len(set(result)) == 2
            else 0
        )

        p["points"] += prize
        save()

        await q.message.reply_text(
            f"🎰 {' '.join(result)}\n"
            f"ربحت {prize} نقطة\n"
            f"رصيدك: {p['points']}",
            reply_markup=menu()
        )

    elif choice == "roulette":
        number = random.randint(0, 36)

        await q.message.reply_text(
            f"🎡 الرقم: {number}\n"
            f"رصيدك: {p['points']}",
            reply_markup=menu()
        )

    elif choice == "crash":
        multiplier = round(random.uniform(1, 5), 2)

        await q.message.reply_text(
            f"🚀 انتهت الجولة عند {multiplier}x",
            reply_markup=menu()
        )

    elif choice == "mines":
        await q.message.reply_text(
            "💣 لعبة الألغام قيد التطوير.",
            reply_markup=menu()
        )


def read_deposits():
    if not DEPOSITS.exists():
        return []

    try:
        return json.loads(DEPOSITS.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        logger.exception("خطأ في قراءة طلبات الشحن")
        return []


def save_deposits(requests):
    DEPOSITS.write_text(
        json.dumps(requests, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


async def messages(update: Update, context: ContextTypes.DEFAULT_TYPE):
    action = context.user_data.get("action")

    if not action or not update.message or not update.message.text:
        return

    uid = str(update.effective_user.id)
    p = account(uid)
    value = update.message.text.strip()

    if action == "register_username":

        if (
            len(value) < 3
            or len(value) > 20
            or not value.replace("_", "").isalnum()
        ):
            await update.message.reply_text(
                "اسم المستخدم يجب أن يكون 3 إلى 20 حرفاً أو رقماً."
            )
            return

        if any(
            x.get("username") == value
            for x in players.values()
        ):
            await update.message.reply_text(
                "اسم المستخدم مستخدم. اختر اسماً آخر."
            )
            return

        context.user_data["new_username"] = value
        context.user_data["action"] = "register_password"

        await update.message.reply_text(
            "أرسل كلمة مرور لحسابك (8 أحرف على الأقل):"
        )

    elif action == "register_password":

        if len(value) < 8:
            await update.message.reply_text(
                "كلمة المرور قصيرة. أرسل 8 أحرف على الأقل."
            )
            return

        salt = secrets.token_hex(16)

        digest = hashlib.pbkdf2_hmac(
            "sha256",
            value.encode(),
            salt.encode(),
            200000
        ).hex()

        p["username"] = context.user_data.pop("new_username")
        p["password"] = salt + ":" + digest

        save()

        context.user_data.pop("action", None)

        await update.message.reply_text(
            "✅ تم إنشاء حسابك بنجاح!",
            reply_markup=menu()
        )

    elif action == "deposit_amount":

        try:
            amount = int(value)

            if amount <= 0:
                raise ValueError

        except ValueError:
            await update.message.reply_text(
                "أرسل مبلغاً صحيحاً."
            )
            return

        context.user_data["deposit_amount"] = amount
        context.user_data["action"] = "deposit_reference"

        await update.message.reply_text(
            "أرسل رقم العملية الآن:"
        )

    elif action == "deposit_reference":

        reference = value

        if len(reference) < 3 or len(reference) > 80:
            await update.message.reply_text(
                "رقم العملية غير صحيح. أعد إرساله."
            )
            return

        requests = read_deposits()

        method = context.user_data.get(
            "payment_method",
            "unknown"
        )

        duplicate = any(
            r.get("reference") == reference
            and r.get("payment_method") == method
            for r in requests
        )

        if duplicate:
            await update.message.reply_text(
                "⚠️ رقم العملية مسجل مسبقاً. تحقق منه وأرسل الرقم الصحيح."
            )
            return

        amount = context.user_data.pop("deposit_amount")

        requests.append({
            "user_id": uid,
            "amount": amount,
            "payment_method": method,
            "reference": reference,
            "status": "pending"
        })

        save_deposits(requests)

        context.user_data.pop("action", None)
        context.user_data.pop("payment_method", None)

        await update.message.reply_text(
            f"✅ تم استلام طلب الشحن.\n"
            f"طريقة الدفع: {method}\n"
            f"المبلغ: {amount}\n"
            f"رقم العملية: {reference}\n"
            "الحالة: قيد المراجعة.\n\n"
            "لن يضاف الرصيد قبل التحقق من العملية.",
            reply_markup=menu()
        )

    elif action == "withdraw":

        try:
            amount = int(value)

            if amount <= 0:
                raise ValueError

        except ValueError:
            await update.message.reply_text(
                "أرسل مبلغاً صحيحاً."
            )
            return

        if amount > p["points"]:
            await update.message.reply_text(
                "رصيدك لا يكفي."
            )
            return

        p["points"] -= amount
        save()

        context.user_data.pop("action", None)

        await update.message.reply_text(
            f"تم تحديث رصيدك التجريبي.\n"
            f"رصيدك: {p['points']}",
            reply_markup=menu()
        )


def main():
    load()

    app = Application.builder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(buttons))

    app.add_handler(
        MessageHandler(
            filters.TEXT & ~filters.COMMAND,
            messages
        )
    )

    print("LION GAMES BOT IS RUNNING")

    app.run_polling()


if __name__ == "__main__":
    main()
