import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";

export function NavBar() {
  return (
    <nav
      className="
      w-full border-b bg-white/80 backdrop-blur-2xl
      supports-backdrop-filter:bg-white/60 sticky top-0 z-50"
    >
      <div
        className="
          container mx-auto h-16 flex
          items-center justify-between
          px-4
        "
      >
        <Link
          href={"/"}
          className="
          font-bold text-xl tracking-tight text-gray-900
          "
        >
          MicroSkills Wiki
        </Link>
        <NavigationMenu>
          <NavigationMenuList
            className="
            flex items-center gap-2
            "
          >
            <NavigationMenuItem>
              <Button variant={"outline"}>
                <Link href={"/signin"}>Sign In</Link>
              </Button>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <Button variant={"secondary"}>
                <Link href={"/signup"}>Sign Up</Link>
              </Button>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </div>
    </nav>
  );
}
