import { Children, isValidElement, type ReactNode } from "react";
import { Tab, Tabs as FumadocsTabs } from "fumadocs-ui/components/tabs";

interface TabItemProps {
	label: string;
	children: ReactNode;
}

interface TabsProps {
	syncKey?: string;
	children: ReactNode;
}

export function TabItem({ children }: TabItemProps) {
	return <Tab>{children}</Tab>;
}

export function Tabs({ syncKey, children }: TabsProps) {
	const items = Children.toArray(children).flatMap((child) =>
		isValidElement<TabItemProps>(child) ? [child.props.label] : [],
	);

	return (
		<FumadocsTabs items={items} groupId={syncKey}>
			{children}
		</FumadocsTabs>
	);
}
