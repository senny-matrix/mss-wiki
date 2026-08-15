import { WikiCard } from "@/components/wiki-card";

export default function Home() {
  return (
    <div>
      <main className="max-w-2xl mx-auto mt-10 flex flex-col gap-6">
        <WikiCard
          title="Advanced Networking"
          author="Rogers Aaron"
          date="Sep 2025"
          summary="Learn Advanced Networking including firewalls, virtual machine
          networks, live migrations, cryptography, Active Directory, Network
          Infrastructure services (like DHCP, NDS, NAT, etc), Security Tools etc"
          href="https://microskills.ac.tz"
        />
        <WikiCard
          title="Rust Programming for Chosen"
          author="Rogers Aaron"
          date="Sep 2026"
          summary="Learn Rust Programming language including ownership model,
          memory safety, rust in networks, rust in web development, System
          Administration tools in rust, Network Infrastructure services
          implementation in Rust (like DHCP, NDS, NAT, etc), Security Tools etc"
          href="https://microskills.ac.tz"
        />
        <WikiCard
          title="Python for Automation"
          author="Rogers Aaron"
          date="Oct 2026"
          summary="Learn Python Programming for automation, scripting, data
          processing, web scraping, and building command-line tools. Covers
          fundamentals, standard library, and real-world workflows."
          href="https://microskills.ac.tz"
        />
        <WikiCard
          title="Linux System Administration"
          author="Rogers Aaron"
          date="Nov 2026"
          summary="Learn Linux System Administration including the shell, file
          systems, users and permissions, process management, services,
          networking, and automating routine maintenance tasks."
          href="https://microskills.ac.tz"
        />
        <WikiCard
          title="Cybersecurity Fundamentals"
          author="Rogers Aaron"
          date="Dec 2026"
          summary="Learn Cybersecurity Fundamentals including threat modeling,
          cryptography, authentication, network security, incident response,
          and best practices for securing systems and applications."
          href="https://microskills.ac.tz"
        />
        <WikiCard
          title="Data Science with Python"
          author="Rogers Aaron"
          date="Jan 2027"
          summary="Learn Data Science with Python including data cleaning,
          visualization, statistics, and machine learning using pandas, NumPy,
          and scikit-learn for real-world datasets."
          href="https://microskills.ac.tz"
        />
        <WikiCard
          title="Web Development with Next.js"
          author="Rogers Aaron"
          date="Feb 2027"
          summary="Learn Web Development with Next.js including routing, data
          fetching, server and client components, styling with Tailwind CSS,
          and deploying full-stack applications."
          href="https://microskills.ac.tz"
        />
      </main>
    </div>
  );
}
