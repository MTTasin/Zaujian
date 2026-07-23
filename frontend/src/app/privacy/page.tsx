import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "গোপনীয়তা নীতি",
  description:
    "Zaujain Nikah Point কীভাবে আপনার তথ্য সংগ্রহ, ব্যবহার ও সুরক্ষিত রাখে — গোপনীয়তা নীতি।",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="গোপনীয়তা" title="গোপনীয়তা নীতি" updated="১৭ জুলাই, ২০২৬">
      <p className="text-muted">
        Zaujain Nikah Point-এ আপনার গোপনীয়তা আমাদের কাছে গুরুত্বপূর্ণ। এই নীতিতে আমরা
        কীভাবে আপনার তথ্য সংগ্রহ করি, ব্যবহার করি এবং সুরক্ষিত রাখি তা ব্যাখ্যা করা হলো।
      </p>

      <LegalSection heading="আমরা কী তথ্য সংগ্রহ করি">
        <p>অর্ডার সম্পন্ন করতে আমরা নিচের তথ্য সংগ্রহ করি:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>নাম, ফোন/হোয়াটসঅ্যাপ নম্বর ও ইমেইল</li>
          <li>ডেলিভারি ঠিকানা (বিভাগ, জেলা, থানা)</li>
          <li>কাস্টমাইজেশন তথ্য — বর/কনের নাম, বিয়ের তারিখ, ডিজাইন ও লেখা পছন্দ</li>
          <li>প্রয়োজনে বিকাশ/নগদ পেমেন্টের স্ক্রিনশট ও ট্রানজেকশন তথ্য</li>
        </ul>
      </LegalSection>

      <LegalSection heading="কেন সংগ্রহ করি">
        <ul className="list-disc space-y-1 pl-5">
          <li>আপনার কাস্টমাইজড নিকাহনামা কম্বো তৈরি ও প্রস্তুত করতে</li>
          <li>কুরিয়ার (Steadfast / Pathao) এর মাধ্যমে অর্ডার ডেলিভারি সমন্বয় করতে</li>
          <li>ফোনে অর্ডার নিশ্চিত করতে ও প্রয়োজনে পেমেন্ট যাচাই করতে</li>
        </ul>
      </LegalSection>

      <LegalSection heading="তথ্য শেয়ার করা">
        <p>
          <strong className="text-foreground">আমরা আপনার তথ্য কোনো তৃতীয় পক্ষের কাছে বিক্রি করি না।</strong>{" "}
          কেবল অর্ডার সম্পন্ন করার জন্য প্রয়োজনীয় ডেলিভারি ও পেমেন্ট যাচাই পার্টনারের
          সাথে সীমিত তথ্য শেয়ার করা হয়।
        </p>
      </LegalSection>

      <LegalSection heading="আপনার অধিকার">
        <p>
          আপনি যেকোনো সময় আপনার সংরক্ষিত তথ্য দেখতে, সংশোধন করতে বা মুছে ফেলার
          অনুরোধ করতে পারেন। এজন্য আমাদের সাথে যোগাযোগ করুন।
        </p>
      </LegalSection>

      <LegalSection heading="তথ্য সংরক্ষণ">
        <p>
          অর্ডার সম্পন্ন করা ও ব্যবসায়িক রেকর্ড রাখার জন্য যতদিন প্রয়োজন ততদিন আপনার
          তথ্য সংরক্ষণ করা হয়।
        </p>
      </LegalSection>

      <LegalSection heading="যোগাযোগ">
        <p>এই নীতি সম্পর্কে কোনো প্রশ্ন থাকলে:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>ফোন: 01959976683, 01974283081</li>
          <li>
            ফেসবুক:{" "}
            <a href="https://www.facebook.com/ZaujainNikahPoint" className="text-plum underline" target="_blank" rel="noreferrer">
              facebook.com/ZaujainNikahPoint
            </a>
          </li>
          <li>ঠিকানা: জি.এ. ভবন (ইউনিট-১), আন্দরকিল্লা শাহি জামে মসজিদের সামনে, আন্দরকিল্লা, কোতোয়ালী, চট্টগ্রাম।</li>
        </ul>
        <p className="pt-2">
          আরও দেখুন:{" "}
          <Link href="/terms" className="text-plum underline">শর্তাবলী</Link>।
        </p>
      </LegalSection>
    </LegalPage>
  );
}
